import { PriceBar } from '../market-data/provider-interface'
import { resolveSoxlConfig, type SoxlStrategyConfig } from './config'

export interface BacktestScenario {
  id: string
  name: string
  startDate: string
  endDate: string
  description: string
}

export const BACKTEST_SCENARIOS: BacktestScenario[] = [
  {
    id: 'bear_2022',
    name: '2022 年半導體深度熊市',
    startDate: '2021-12-01',
    endDate: '2023-06-30',
    description: 'SOXX 自高點下跌逾 -45%，SOXL 暴跌逾 -85%，檢驗三倍槓桿波動耗損與分批進場成效。',
  },
  {
    id: 'covid_2020',
    name: '2020 年疫情極限崩跌與V轉',
    startDate: '2020-01-01',
    endDate: '2021-06-30',
    description: '極速閃崩 -30% 以上後極速反彈，考驗進場門檻是否及時觸發及停利出場速度。',
  },
  {
    id: 'trade_war_2018',
    name: '2018 年美中貿易戰修正',
    startDate: '2018-01-01',
    endDate: '2019-06-30',
    description: '震盪式下跌，考驗狙擊期門檻是否避免過早滿倉。',
  },
]

export interface BacktestConfig {
  scenarioId?: string
  initialCapital: number // USD（代表整體投資資產）
  /** 策略參數；未提供時用 lib/strategies/config.ts 預設（上限 10%＝2.5% × 4 批） */
  strategy?: Partial<SoxlStrategyConfig>
  feeRate: number // 0.001
  slippageRate: number // 0.001
}

export interface BacktestTrade {
  date: string
  type: 'BUY' | 'SELL'
  tranche?: number
  exitTier?: number
  /** 實際成交價（已含滑價：買進較高、賣出較低） */
  price: number
  quantity: number
  fee: number
  returnPercent?: number
  pnl?: number
  reason: string
}

export interface BacktestResult {
  scenarioName: string
  period: string
  config: SoxlStrategyConfig
  initialCapital: number
  finalEquity: number
  totalReturnPercent: number
  annualizedReturnPercent: number
  maxDrawdownPercent: number
  tradesCount: number
  /** 獲利賣單 ÷ 全部賣單；沒有任何賣單時為 null（不假給 100%） */
  winRate: number | null
  /** 每一輪「建倉 → 清倉（或回測結束）」的平均持有週數 */
  avgHoldingWeeks: number
  /** 單筆賣出最大虧損 %（相對該筆成本，負數；沒有虧損賣單為 0） */
  maxSingleLossPercent: number
  cashIdlePercent: number
  benchmarkReturnPercent: number // Buy & Hold SOXX
  /** 因 SOXL 沒有同日資料而略過的週數 */
  skippedWeeks: number
  trades: BacktestTrade[]
  equityCurve: { date: string; equity: number; soxxPrice: number }[]
}

const dateKey = (ts: string) => ts.split('T')[0]

/**
 * 以實際週 K 序列回測 SOXL 狙擊策略（規則與實盤 soxl-engine 相同）：
 * - 本輪高點（週收盤）之後，週 K 盤中低點第一次跌到啟動門檻 → 啟動狙擊期
 * - 第 1 批立即可買；第 k 批於啟動後滿 intervalWeeks × (k-1) 週解鎖，
 *   或跌到 earlyUnlockDrawdowns[k-1] 提前解鎖；沒有門檻的最後一批可因站回 10 週均線並突破前 4 週高點提前解鎖
 * - 每批 = 當下總資產 × tranchePercent，再買會超過上限就不買
 * - 停利依本輪累計賣出比例：+80% 賣到 1/3、+150% 賣到 2/3、+200% 全清
 * - 創新高 → 狙擊期結束、批次重置；清倉 → 停利階梯與本輪建倉量重置
 */
export function runSoxlBacktest(params: {
  soxxBars: PriceBar[]
  soxlBars: PriceBar[]
  config?: Partial<BacktestConfig>
  scenarioName?: string
}): BacktestResult {
  const { soxxBars, soxlBars, config = {}, scenarioName = '自訂歷史區間' } = params

  const cfg = resolveSoxlConfig(config.strategy)
  const initialCapital = config.initialCapital || 10000
  const feeRate = config.feeRate ?? 0.001
  const slippageRate = config.slippageRate ?? 0.001
  const maxWeight = cfg.maxPositionPercent / 100
  const trancheWeight = cfg.tranchePercent / 100

  const empty: BacktestResult = {
    scenarioName,
    period: '無資料',
    config: cfg,
    initialCapital,
    finalEquity: initialCapital,
    totalReturnPercent: 0,
    annualizedReturnPercent: 0,
    maxDrawdownPercent: 0,
    tradesCount: 0,
    winRate: null,
    avgHoldingWeeks: 0,
    maxSingleLossPercent: 0,
    cashIdlePercent: 100,
    benchmarkReturnPercent: 0,
    skippedWeeks: 0,
    trades: [],
    equityCurve: [],
  }
  if (!soxxBars || soxxBars.length === 0 || !soxlBars || soxlBars.length === 0) return empty

  const soxlMap = new Map<string, PriceBar>()
  for (const b of soxlBars) soxlMap.set(dateKey(b.timestamp), b)

  let cash = initialCapital
  let units = 0
  let costBasis = 0 // 平均成本（含買進手續費）

  // 狙擊期狀態（依 SOXX 高點）
  let cyclePeak = 0
  let maxDrawdownSincePeak = 0
  let activatedWeek: number | null = null
  const executedTranches = new Set<number>()

  // 持倉週期狀態（依清倉重置）
  let cycleBought = 0
  let cycleSold = 0
  let positionOpenedWeek: number | null = null
  const holdingWeeks: number[] = []

  const trades: BacktestTrade[] = []
  const equityCurve: BacktestResult['equityCurve'] = []
  const soxxCloses: number[] = []
  let peakEquity = initialCapital
  let maxDrawdown = 0
  let skippedWeeks = 0
  let week = -1 // 有效（對得到 SOXL 資料）的週序號

  for (let i = 0; i < soxxBars.length; i++) {
    const bar = soxxBars[i]
    const dateStr = dateKey(bar.timestamp)
    const soxlBar = soxlMap.get(dateStr)
    // 日期對不上就整週略過，不再用陣列索引硬配（會配到別週的價格）
    if (!soxlBar) {
      skippedWeeks++
      continue
    }
    week++
    soxxCloses.push(bar.close)
    const close = soxlBar.close
    const buyPrice = close * (1 + slippageRate)
    const sellPrice = close * (1 - slippageRate)

    // 高點更新 → 狙擊期結束、批次重置
    if (bar.close > cyclePeak) {
      cyclePeak = bar.close
      maxDrawdownSincePeak = 0
      activatedWeek = null
      executedTranches.clear()
    }
    const closeDd = (bar.close / cyclePeak - 1) * 100
    const lowDd = (Math.min(bar.low || bar.close, bar.close) / cyclePeak - 1) * 100
    maxDrawdownSincePeak = Math.min(maxDrawdownSincePeak, lowDd)
    if (activatedWeek === null && maxDrawdownSincePeak <= cfg.activateDrawdown) activatedWeek = week

    // 週線條件：站回 10 週均線且突破前 4 週最高收盤
    const n = soxxCloses.length
    const ma10 = n >= 10 ? soxxCloses.slice(-10).reduce((a, b) => a + b, 0) / 10 : null
    const prev4 = n >= 5 ? Math.max(...soxxCloses.slice(-5, -1)) : null
    const breakout = ma10 !== null && prev4 !== null && bar.close >= ma10 && bar.close > prev4

    // ---- 進場 ----
    if (activatedWeek !== null) {
      const weeksSince = week - activatedWeek
      for (let k = 1; k <= cfg.trancheCount; k++) {
        if (executedTranches.has(k)) continue
        const early = cfg.earlyUnlockDrawdowns[k - 1]
        const unlocked =
          k === 1 ||
          weeksSince >= cfg.intervalWeeks * (k - 1) ||
          (early !== undefined ? maxDrawdownSincePeak <= early : breakout)
        if (!unlocked) continue

        const equity = cash + units * close
        const holdingWeight = equity > 0 ? (units * close) / equity : 0
        if (holdingWeight + trancheWeight > maxWeight + 1e-4) break // 再買會超過上限

        const budget = Math.min(equity * trancheWeight, cash)
        const buyQty = Math.floor(budget / (buyPrice * (1 + feeRate)))
        if (buyQty <= 0) break
        const gross = buyQty * buyPrice
        const fee = gross * feeRate
        cash -= gross + fee // 扣實際成交金額，零股差額留在現金
        costBasis = (units * costBasis + gross + fee) / (units + buyQty)
        if (units === 0) positionOpenedWeek = week
        units += buyQty
        cycleBought += buyQty
        executedTranches.add(k)
        trades.push({
          date: dateStr,
          type: 'BUY',
          tranche: k,
          price: buyPrice,
          quantity: buyQty,
          fee,
          reason: `SOXX 回撤 ${closeDd.toFixed(1)}%（本輪最深 ${maxDrawdownSincePeak.toFixed(1)}%），第 ${k} 批進場`,
        })
      }
    }

    // ---- 停利 ----
    if (units > 0 && costBasis > 0) {
      const returnPct = (close / costBasis - 1) * 100
      const tiers = [...cfg.exitTiers].sort((a, b) => a.gainPercent - b.gainPercent)
      for (const t of tiers) {
        if (units <= 0 || returnPct < t.gainPercent) continue
        const soldRatio = cycleBought > 0 ? cycleSold / cycleBought : 0
        if (t.cumulativeSellRatio < 1 && soldRatio >= t.cumulativeSellRatio - 1e-9) continue
        const target = t.cumulativeSellRatio >= 1 ? units : Math.ceil(cycleBought * t.cumulativeSellRatio - cycleSold - 1e-9)
        const sellQty = Math.min(units, Math.max(1, target)) // 至少賣 1 股，避免零股卡死
        const gross = sellQty * sellPrice
        const fee = gross * feeRate
        const pnl = (sellPrice - costBasis) * sellQty - fee
        cash += gross - fee
        units -= sellQty
        cycleSold += sellQty
        trades.push({
          date: dateStr,
          type: 'SELL',
          exitTier: t.tier,
          price: sellPrice,
          quantity: sellQty,
          fee,
          returnPercent: returnPct,
          pnl,
          reason: `獲利達 ${returnPct.toFixed(1)}%，第 ${t.tier} 批停利${t.cumulativeSellRatio >= 1 ? '清空持倉' : `（累計賣出 ${Math.round(t.cumulativeSellRatio * 100)}%）`}`,
        })
      }
      if (units === 0) {
        // 清倉 → 本輪結束，下一輪重新計算建倉量與停利階梯
        if (positionOpenedWeek !== null) holdingWeeks.push(week - positionOpenedWeek)
        positionOpenedWeek = null
        cycleBought = 0
        cycleSold = 0
        costBasis = 0
      }
    }

    // 淨值用市價（收盤價），不含滑價
    const equity = cash + units * close
    if (equity > peakEquity) peakEquity = equity
    const dd = ((equity - peakEquity) / peakEquity) * 100
    if (dd < maxDrawdown) maxDrawdown = dd
    equityCurve.push({ date: dateStr, equity: Math.round(equity * 100) / 100, soxxPrice: bar.close })
  }

  if (equityCurve.length === 0) return { ...empty, skippedWeeks }
  if (units > 0 && positionOpenedWeek !== null) holdingWeeks.push(week - positionOpenedWeek)

  const finalEquity = equityCurve[equityCurve.length - 1].equity
  const totalReturnPercent = Number((((finalEquity - initialCapital) / initialCapital) * 100).toFixed(2))
  const totalWeeks = equityCurve.length
  const annualizedReturnPercent = Number(((Math.pow(finalEquity / initialCapital, 52 / totalWeeks) - 1) * 100).toFixed(2))

  const sellTrades = trades.filter((t) => t.type === 'SELL')
  const winRate =
    sellTrades.length > 0
      ? Number(((sellTrades.filter((t) => (t.pnl ?? 0) > 0).length / sellTrades.length) * 100).toFixed(1))
      : null
  const lossPercents = sellTrades.map((t) => {
    const basis = t.price * t.quantity - (t.pnl ?? 0) - t.fee // 該筆成本 = 賣出金額 − 損益 − 手續費
    return basis > 0 ? ((t.pnl ?? 0) / basis) * 100 : 0
  })
  const maxSingleLossPercent = Number(Math.min(0, ...lossPercents).toFixed(2))

  const firstSoxx = soxxCloses[0]
  const lastSoxx = soxxCloses[soxxCloses.length - 1]

  return {
    scenarioName,
    period: `${equityCurve[0].date} ~ ${equityCurve[equityCurve.length - 1].date}`,
    config: cfg,
    initialCapital,
    finalEquity,
    totalReturnPercent,
    annualizedReturnPercent,
    maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
    tradesCount: trades.length,
    winRate,
    avgHoldingWeeks: holdingWeeks.length
      ? Number((holdingWeeks.reduce((a, b) => a + b, 0) / holdingWeeks.length).toFixed(1))
      : 0,
    maxSingleLossPercent,
    cashIdlePercent: Number(((cash / finalEquity) * 100).toFixed(1)),
    benchmarkReturnPercent: Number((((lastSoxx - firstSoxx) / firstSoxx) * 100).toFixed(2)),
    skippedWeeks,
    trades,
    equityCurve,
  }
}
