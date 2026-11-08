import { PriceBar } from '../market-data/provider-interface'

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
    description: 'SOXX 自高點下跌逾 -45%，SOXL 暴跌逾 -85%，檢驗三倍槓桿波動耗損與階梯進場成效。',
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
    description: '震盪式下跌，考驗回撤階梯是否避免過早滿倉。',
  },
]

export interface BacktestConfig {
  scenarioId?: string
  initialCapital: number // USD
  trancheSizePercent: number // e.g. 1.25%
  maxSoxlPositionPercent: number // e.g. 5.0%
  drawdownTranches: number[] // [-40, -45, -50]
  exitTiers: { gain: number; sellRatio: number }[] // [+0.8, +1.5, +2.0]
  feeRate: number // 0.001
  slippageRate: number // 0.001
}

export interface BacktestTrade {
  date: string
  type: 'BUY' | 'SELL'
  tranche?: number
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
  initialCapital: number
  finalEquity: number
  totalReturnPercent: number
  annualizedReturnPercent: number
  maxDrawdownPercent: number
  tradesCount: number
  winRate: number
  avgHoldingWeeks: number
  maxSingleLossPercent: number
  cashIdlePercent: number
  benchmarkReturnPercent: number // Buy & Hold SOXX/Benchmark
  trades: BacktestTrade[]
  equityCurve: { date: string; equity: number; soxxPrice: number }[]
}

/**
 * Runs historical strategy backtest using actual price series
 */
export function runSoxlBacktest(params: {
  soxxBars: PriceBar[]
  soxlBars: PriceBar[]
  config?: Partial<BacktestConfig>
  scenarioName?: string
}): BacktestResult {
  const { soxxBars, soxlBars, config = {}, scenarioName = '自訂歷史區間' } = params

  const initialCapital = config.initialCapital || 10000
  const maxSoxlWeight = (config.maxSoxlPositionPercent || 5.0) / 100
  const trancheWeight = (config.trancheSizePercent || 1.25) / 100
  const feeRate = config.feeRate ?? 0.001
  const slippageRate = config.slippageRate ?? 0.001

  if (!soxxBars || soxxBars.length === 0 || !soxlBars || soxlBars.length === 0) {
    return {
      scenarioName,
      period: '無資料',
      initialCapital,
      finalEquity: initialCapital,
      totalReturnPercent: 0,
      annualizedReturnPercent: 0,
      maxDrawdownPercent: 0,
      tradesCount: 0,
      winRate: 0,
      avgHoldingWeeks: 0,
      maxSingleLossPercent: 0,
      cashIdlePercent: 100,
      benchmarkReturnPercent: 0,
      trades: [],
      equityCurve: [],
    }
  }

  // Map SOXL bars by timestamp/date for fast lookup
  const soxlMap = new Map<string, PriceBar>()
  for (const b of soxlBars) {
    soxlMap.set(b.timestamp.split('T')[0], b)
  }

  let cash = initialCapital
  let soxlUnits = 0
  let costBasis = 0
  let initialTrancheUnits = 0

  let cyclePeak = soxxBars[0].close
  const trades: BacktestTrade[] = []
  const equityCurve: BacktestResult['equityCurve'] = []

  let peakEquity = initialCapital
  let maxDrawdown = 0
  let executedTranches = new Set<number>()

  for (let i = 0; i < soxxBars.length; i++) {
    const bar = soxxBars[i]
    const dateStr = bar.timestamp.split('T')[0]
    const soxlBar = soxlMap.get(dateStr) || soxlBars[Math.min(i, soxlBars.length - 1)]
    const soxlPrice = soxlBar.close * (1 + slippageRate)

    // Update cycle peak
    if (bar.close > cyclePeak && soxlUnits === 0) {
      cyclePeak = bar.close
      executedTranches.clear()
    }

    const drawdown = ((bar.close - cyclePeak) / cyclePeak) * 100

    // Evaluate Entry Tranches (1 to 3)
    if (soxlUnits === 0 || (soxlUnits * soxlPrice) / (cash + soxlUnits * soxlPrice) < maxSoxlWeight) {
      // Tranche 1: -40%
      if (drawdown <= -40 && !executedTranches.has(1)) {
        const allocateCash = initialCapital * trancheWeight
        const buyQty = Math.floor(allocateCash / soxlPrice)
        if (buyQty > 0 && cash >= allocateCash) {
          const fee = allocateCash * feeRate
          cash -= allocateCash + fee
          soxlUnits += buyQty
          costBasis = soxlPrice
          initialTrancheUnits += buyQty
          executedTranches.add(1)
          trades.push({
            date: dateStr,
            type: 'BUY',
            tranche: 1,
            price: soxlPrice,
            quantity: buyQty,
            fee,
            reason: `SOXX 回撤 ${drawdown.toFixed(1)}% 觸發第 1 批進場`,
          })
        }
      }

      // Tranche 2: -45%
      if (drawdown <= -45 && !executedTranches.has(2)) {
        const allocateCash = initialCapital * trancheWeight
        const buyQty = Math.floor(allocateCash / soxlPrice)
        if (buyQty > 0 && cash >= allocateCash) {
          const fee = allocateCash * feeRate
          const totalCostBefore = soxlUnits * costBasis
          cash -= allocateCash + fee
          soxlUnits += buyQty
          costBasis = (totalCostBefore + allocateCash) / soxlUnits
          initialTrancheUnits += buyQty
          executedTranches.add(2)
          trades.push({
            date: dateStr,
            type: 'BUY',
            tranche: 2,
            price: soxlPrice,
            quantity: buyQty,
            fee,
            reason: `SOXX 回撤 ${drawdown.toFixed(1)}% 觸發第 2 批進場`,
          })
        }
      }

      // Tranche 3: -50%
      if (drawdown <= -50 && !executedTranches.has(3)) {
        const allocateCash = initialCapital * trancheWeight
        const buyQty = Math.floor(allocateCash / soxlPrice)
        if (buyQty > 0 && cash >= allocateCash) {
          const fee = allocateCash * feeRate
          const totalCostBefore = soxlUnits * costBasis
          cash -= allocateCash + fee
          soxlUnits += buyQty
          costBasis = (totalCostBefore + allocateCash) / soxlUnits
          initialTrancheUnits += buyQty
          executedTranches.add(3)
          trades.push({
            date: dateStr,
            type: 'BUY',
            tranche: 3,
            price: soxlPrice,
            quantity: buyQty,
            fee,
            reason: `SOXX 回撤 ${drawdown.toFixed(1)}% 觸發第 3 批進場`,
          })
        }
      }
    }

    // Evaluate Exit Tiers (+80%, +150%, +200%)
    if (soxlUnits > 0 && costBasis > 0) {
      const returnPct = ((soxlPrice - costBasis) / costBasis) * 100

      // Tier 1: +80% -> Sell 1/3 of position
      if (returnPct >= 80 && soxlUnits > 0 && !executedTranches.has(101)) {
        const sellQty = Math.floor(initialTrancheUnits / 3)
        if (sellQty > 0 && soxlUnits >= sellQty) {
          const proceed = sellQty * soxlPrice
          const fee = proceed * feeRate
          cash += proceed - fee
          soxlUnits -= sellQty
          executedTranches.add(101)
          trades.push({
            date: dateStr,
            type: 'SELL',
            price: soxlPrice,
            quantity: sellQty,
            fee,
            returnPercent: returnPct,
            pnl: (soxlPrice - costBasis) * sellQty - fee,
            reason: `獲利達 ${returnPct.toFixed(1)}%，執行第 1 批停利賣出 1/3`,
          })
        }
      }

      // Tier 2: +150% -> Sell another 1/3
      if (returnPct >= 150 && soxlUnits > 0 && !executedTranches.has(102)) {
        const sellQty = Math.floor(initialTrancheUnits / 3)
        if (sellQty > 0 && soxlUnits >= sellQty) {
          const proceed = sellQty * soxlPrice
          const fee = proceed * feeRate
          cash += proceed - fee
          soxlUnits -= sellQty
          executedTranches.add(102)
          trades.push({
            date: dateStr,
            type: 'SELL',
            price: soxlPrice,
            quantity: sellQty,
            fee,
            returnPercent: returnPct,
            pnl: (soxlPrice - costBasis) * sellQty - fee,
            reason: `獲利達 ${returnPct.toFixed(1)}%，執行第 2 批停利累計 2/3`,
          })
        }
      }

      // Tier 3: +200% -> Sell all
      if (returnPct >= 200 && soxlUnits > 0) {
        const sellQty = soxlUnits
        const proceed = sellQty * soxlPrice
        const fee = proceed * feeRate
        cash += proceed - fee
        soxlUnits = 0
        executedTranches.add(103)
        trades.push({
          date: dateStr,
          type: 'SELL',
          price: soxlPrice,
          quantity: sellQty,
          fee,
          returnPercent: returnPct,
          pnl: (soxlPrice - costBasis) * sellQty - fee,
          reason: `獲利達 ${returnPct.toFixed(1)}%，執行第 3 批清空持倉`,
        })
      }
    }

    // Equity calculation
    const currentEquity = cash + soxlUnits * soxlPrice
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity
    }
    const currentDd = ((currentEquity - peakEquity) / peakEquity) * 100
    if (currentDd < maxDrawdown) {
      maxDrawdown = currentDd
    }

    equityCurve.push({
      date: dateStr,
      equity: Math.round(currentEquity),
      soxxPrice: bar.close,
    })
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital
  const totalReturnPercent = Number((((finalEquity - initialCapital) / initialCapital) * 100).toFixed(2))

  const totalWeeks = soxxBars.length
  const annualizedReturnPercent =
    totalWeeks > 0 ? Number((Math.pow(finalEquity / initialCapital, 52 / totalWeeks) - 1) * 100).toFixed(2) : 0

  // Win rate
  const sellTrades = trades.filter((t) => t.type === 'SELL')
  const winningTrades = sellTrades.filter((t) => (t.pnl || 0) > 0)
  const winRate = sellTrades.length > 0 ? Number(((winningTrades.length / sellTrades.length) * 100).toFixed(1)) : 100

  // Benchmark Return (Buy & Hold SOXX)
  const firstSoxx = soxxBars[0].close
  const lastSoxx = soxxBars[soxxBars.length - 1].close
  const benchmarkReturnPercent = Number((((lastSoxx - firstSoxx) / firstSoxx) * 100).toFixed(2))

  return {
    scenarioName,
    period: `${soxxBars[0].timestamp.split('T')[0]} ~ ${soxxBars[soxxBars.length - 1].timestamp.split('T')[0]}`,
    initialCapital,
    finalEquity,
    totalReturnPercent,
    annualizedReturnPercent: Number(annualizedReturnPercent),
    maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
    tradesCount: trades.length,
    winRate,
    avgHoldingWeeks: Math.round(totalWeeks / Math.max(1, sellTrades.length)),
    maxSingleLossPercent: 0,
    cashIdlePercent: Number(((cash / finalEquity) * 100).toFixed(1)),
    benchmarkReturnPercent,
    trades,
    equityCurve,
  }
}
