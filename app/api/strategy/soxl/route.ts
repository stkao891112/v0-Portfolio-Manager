import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import {
  analyzeSoxxIndicators,
  applyLiveQuoteToBars,
  calculateAnnualizedVolatility,
  calculateAtrPercent,
} from '@/lib/strategies/indicators'
import { evaluateSoxlSniperStrategy } from '@/lib/strategies/soxl-engine'
import { loadPortfolioSettings, loadSoxlConfig } from '@/lib/strategies/config-loader'
import { sqlite, type Statement } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { applyTrade, LedgerError } from '@/lib/ledger'
import { isCashLikeSymbol, assetUnitPrice, convertCurrency } from '@/lib/valuation'
import { getNextColor } from '@/lib/portfolio-types'
import { v4 as uuidv4 } from 'uuid'
import { getYahooCloses, getYahooDaily, getUsUnemployment, getTsmcMonthlyRevenue } from '@/lib/market-data/external-sources'
import { evaluateMacro } from '@/lib/strategies/macro-check'

export const dynamic = 'force-dynamic'

/** 舊資料（strategy_tranche 欄位還沒有值時）才退回用備註比對「第 N 批」 */
function legacyTrancheFromNotes(notes: unknown): number | null {
  const m = String(notes || '').match(/第\s*([1-9])\s*批/)
  return m ? Number(m[1]) : null
}

type CycleTransaction = { type: string; quantity: number; strategy_tranche?: number | null; notes?: string | null; date: string; created_at?: string }

/** GET 與 POST 共用：從 cyclePeakDate 起計算執行批次，持倉歸零時清除本輪集合。 */
export function getExecutedTranchesSinceCyclePeak(
  transactions: CycleTransaction[],
  cyclePeakDate: string,
  trancheCount: number
): number[] {
  const startDate = cyclePeakDate.slice(0, 10)
  const ordered = transactions
    .filter((tx) => tx.date >= startDate && ['BUY', 'SELL', 'INITIAL_BALANCE'].includes(tx.type))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  let run = 0
  let executed = new Set<number>()
  for (const tx of ordered) {
    const quantity = Number(tx.quantity) || 0
    if (tx.type === 'BUY' || tx.type === 'INITIAL_BALANCE') {
      run += quantity
      if (tx.type === 'BUY') {
        const tranche = tx.strategy_tranche != null ? Number(tx.strategy_tranche) : legacyTrancheFromNotes(tx.notes)
        if (tranche && tranche >= 1 && tranche <= trancheCount) executed.add(tranche)
      }
    } else {
      run = Math.max(0, run - quantity)
      if (run <= 1e-9) executed = new Set<number>()
    }
  }
  return [...executed]
}

/** 以「系統設定」匯率換成 USD 的總資產與 SOXL 預備金現金（與資產配置頁同一口徑） */
function portfolioInUsd(allAssets: any[], exchangeRate: number) {
  let total = 0
  let cash = 0
  for (const a of allAssets) {
    const v = convertCurrency(
      (Number(a.quantity) || 0) * assetUnitPrice({ currentPrice: a.current_price, costPerUnit: a.cost_per_unit }),
      a.currency,
      'USD',
      exchangeRate
    )
    total += v
    if (isCashLikeSymbol(a.symbol)) cash += v
  }
  return { total, cash }
}

export async function GET() {
  try {
    await ensureTablesExist()
    const settings = await loadPortfolioSettings()
    const config = await loadSoxlConfig(settings)

    // 1. 報價、10 年週 K（200 週均線用，含快取）、總經資料，全部自動抓
    const [weekly, soxxDaily, soxlDaily, soxlQuote, soxxQuote, tnx, irx, vix, hyg, ief, dxy, qqq, unemp, tsmc, twd] = await Promise.all([
      marketService.getWeeklyBarsSourced('SOXX', 520),
      getYahooDaily('SOXX', '3y'),
      getYahooDaily('SOXL', '3y').catch(() => ({ value: [], stale: true })),
      marketService.getQuote('SOXL'),
      marketService.getQuote('SOXX'),
      getYahooCloses('^TNX', '6mo', '1d', 3600).catch(() => ({ value: null, stale: true, updatedAt: null, source: 'Yahoo Finance' })),
      getYahooCloses('^IRX', '1mo', '1d', 3600),
      getYahooCloses('^VIX', '1mo', '1d', 15 * 60),
      getYahooCloses('HYG', '6mo', '1d', 3600, true),
      getYahooCloses('IEF', '6mo', '1d', 3600, true),
      getYahooCloses('DX-Y.NYB', '6mo', '1d', 3600).catch(() => ({ value: null, stale: true, updatedAt: null, source: 'Yahoo Finance' })),
      getYahooCloses('QQQ', '6mo', '1d', 3600).catch(() => ({ value: null, stale: true, updatedAt: null, source: 'Yahoo Finance' })),
      getUsUnemployment(),
      getTsmcMonthlyRevenue(),
      getYahooCloses('TWD=X', '5d', '1d', 6 * 3600),
    ])
    const allBars = weekly.value ?? []

    // 2. 本輪高點：近 3 年「日收盤」最高點（已含分割還原）
    //    狙擊期：高點之後「盤中最低」第一次跌到啟動門檻的日期即啟動；創新高時自動重置
    const daily = soxxDaily.value || []
    const persistedCycle = await sqlite.get<{
      cycle_peak: number
      cycle_peak_date: string
      sniper_activated_at: string | null
      max_drawdown_since_peak: number
    }>("SELECT cycle_peak, cycle_peak_date, sniper_activated_at, max_drawdown_since_peak FROM soxl_cycle_state WHERE id = 'default'")
    let peakIdx = -1
    daily.forEach((b, i) => {
      if (peakIdx < 0 || b.c > daily[peakIdx].c) peakIdx = i
    })
    const peakBar = peakIdx >= 0 ? { timestamp: daily[peakIdx].t, close: daily[peakIdx].c } : null
    const peakDate = peakBar?.timestamp ?? (persistedCycle?.cycle_peak_date || null)
    const cyclePeak = peakBar?.close ?? Number(persistedCycle?.cycle_peak ?? 0)
    const afterPeak = peakIdx >= 0 ? daily.slice(peakIdx) : []
    let lowAfterPeak = daily.length === 0 ? cyclePeak * (1 + Number(persistedCycle?.max_drawdown_since_peak ?? 0) / 100) : cyclePeak
    let lowDate: string | null = null
    let sniperActivatedAt: string | null = daily.length === 0 ? persistedCycle?.sniper_activated_at ?? null : null
    for (const b of afterPeak) {
      if (b.l < lowAfterPeak) {
        lowAfterPeak = b.l
        lowDate = b.t
      }
      if (!sniperActivatedAt && cyclePeak > 0 && (b.l / cyclePeak - 1) * 100 <= config.activateDrawdown) {
        sniperActivatedAt = b.t
      }
    }
    const maxDrawdownSincePeak =
      daily.length === 0
        ? Number(persistedCycle?.max_drawdown_since_peak ?? 0)
        : cyclePeak > 0
        ? (lowAfterPeak / cyclePeak - 1) * 100
        : 0

    // 高點時的 200 週均線（判斷前一波是不是泡沫）：取高點日以前的 200 根週 K
    let soxxPeakTo200w: number | null = null
    if (peakBar) {
      const before = allBars.filter((b) => b.timestamp <= peakBar.timestamp)
      if (before.length >= 200) {
        const ma = before.slice(-200).reduce((a, b) => a + b.close, 0) / 200
        soxxPeakTo200w = peakBar.close / ma
      }
    }

    // 3. 技術指標：用即時報價覆蓋最新一根（盤中）週 K 的收盤價，讓回撤、均線即時；
    //    isCurrentBarConfirmed 如實反映最新週 K 是否已收盤（不再一律當成已確認）
    const recent = applyLiveQuoteToBars(allBars.slice(-156), soxxQuote)
    const indicators = {
      ...analyzeSoxxIndicators(recent, cyclePeak),
      volatility20dPercent: calculateAnnualizedVolatility(daily.map((bar) => bar.c), 20),
      volatility60dPercent: calculateAnnualizedVolatility(daily.map((bar) => bar.c), 60),
    }

    // 4. 總經判斷
    const last = (s: { value: { c: number }[] | null }) => s.value?.at(-1)?.c ?? null
    const ratio = (h: typeof hyg.value, f: typeof ief.value, back: number) => {
      if (!h || !f || h.length <= back || f.length <= back) return null
      return h.at(-1 - back)!.c / f.at(-1 - back)!.c
    }
    const rNow = ratio(hyg.value, ief.value, 0)
    const r3m = ratio(hyg.value, ief.value, 63)
    const tnxPoints = tnx.value ?? []
    const tnxOld = tnxPoints.length > 60 ? tnxPoints[tnxPoints.length - 61].c : null
    const tnxNow = tnxPoints.at(-1)?.c ?? null
    // Yahoo ^TNX 以 10 倍值報價（如 42 代表 4.2%），換算成百分點變化。
    const tnxSlope60d = tnxNow != null && tnxOld != null ? (tnxNow - tnxOld) / 10 : null
    const dxyPoints = dxy.value ?? []
    const dxyOld = dxyPoints.length > 60 ? dxyPoints[dxyPoints.length - 61].c : null
    const dxyNow = dxyPoints.at(-1)?.c ?? null
    const dxyChange60d = dxyNow != null && dxyOld != null && dxyOld !== 0 ? (dxyNow / dxyOld - 1) * 100 : null
    const qqqByDate = new Map((qqq.value ?? []).map((point) => [point.t.slice(0, 10), point.c]))
    const soxxQqqRatios = daily.flatMap((point) => {
      const qqqClose = qqqByDate.get(point.t.slice(0, 10))
      return qqqClose != null && qqqClose > 0 ? [point.c / qqqClose] : []
    })
    const soxxQqqOld = soxxQqqRatios.length > 60 ? soxxQqqRatios[soxxQqqRatios.length - 61] : null
    const soxxQqqNow = soxxQqqRatios.at(-1) ?? null
    const soxxQqqChange60d = soxxQqqNow != null && soxxQqqOld != null && soxxQqqOld !== 0 ? (soxxQqqNow / soxxQqqOld - 1) * 100 : null
    const vixRecent = vix.value?.slice(-5) ?? []
    const macro = evaluateMacro({
      unemployment: unemp.value?.map((r) => r.rate) ?? null,
      tnx: last(tnx),
      irx: last(irx),
      vix: last(vix),
      vix5dHigh: vixRecent.length ? Math.max(...vixRecent.map((point) => point.c)) : null,
      hygIefChange3m: rNow && r3m ? (rNow / r3m - 1) * 100 : null,
      tnxSlope60d,
      dxyChange60d,
      soxxQqqChange60d,
      tsmcRevenue: tsmc.value,
      soxxPeakTo200w,
    })

    // 匯率：與資產配置頁相同，使用「系統設定」的匯率；Yahoo 即時匯率僅供參考顯示
    const exchangeRate = settings.exchangeRate
    const marketUsdTwd = last(twd)

    // 5. SOXL 持倉、全部資產、本輪買進紀錄
    const [soxlAsset, allAssets] = await Promise.all([
      sqlite.get<any>("SELECT * FROM assets WHERE UPPER(symbol) = 'SOXL'"),
      sqlite.all<any>('SELECT * FROM assets'),
    ])
    const cyclePeakDate = peakDate ?? '1970-01-01'
    const cycleTransactions = await sqlite.all<CycleTransaction>(
      "SELECT type, quantity, strategy_tranche, notes, date, created_at FROM transactions WHERE UPPER(symbol) = 'SOXL' AND date >= ? AND type IN ('BUY','SELL','INITIAL_BALANCE') ORDER BY date, created_at",
      [cyclePeakDate.slice(0, 10)]
    )
    const soxlQuantity = soxlAsset ? Number(soxlAsset.quantity) || 0 : 0
    const soxlCostBasis = soxlAsset ? Number(soxlAsset.cost_per_unit) || 0 : 0

    // 總資產（USD）：與資產配置頁同一口徑（市價 = 現價，沒有報價用成本），SOXL 權重分母一致
    const { total: totalPortfolioValue, cash: cashAvailable } = portfolioInUsd(allAssets, exchangeRate)

    // 本次持倉週期：從「上次持股歸零」之後開始累計買進與賣出股數（停利階梯判斷用）
    const allTx = await sqlite.all<any>(
      "SELECT type, quantity, date FROM transactions WHERE UPPER(symbol) = 'SOXL' AND type IN ('BUY','SELL','INITIAL_BALANCE') ORDER BY date, created_at"
    )
    let runQty = 0
    let cycleBoughtQty = 0
    let cycleSoldQty = 0
    let holdingCycleStartDate: string | null = null
    for (const tx of allTx) {
      const q = Number(tx.quantity) || 0
      if (tx.type === 'BUY' || tx.type === 'INITIAL_BALANCE') {
        if (runQty <= 0) {
          cycleBoughtQty = 0
          cycleSoldQty = 0
          holdingCycleStartDate = tx.date
        }
        runQty += q
        cycleBoughtQty += q
      } else {
        runQty = Math.max(0, runQty - q)
        cycleSoldQty += q
        if (runQty <= 1e-9) holdingCycleStartDate = null
      }
    }

    // 已執行批次：結構化欄位 strategy_tranche 優先；舊資料沒有欄位值時才比對備註
    const executedTranches = getExecutedTranchesSinceCyclePeak(cycleTransactions, cyclePeakDate, config.trancheCount)
    let unassignedBuysThisCycle = 0
    let batchRunQuantity = 0
    for (const row of cycleTransactions) {
      const quantity = Number(row.quantity) || 0
      if (row.type === 'BUY' || row.type === 'INITIAL_BALANCE') {
        batchRunQuantity += quantity
        if (row.type === 'BUY') {
          const tranche = row.strategy_tranche != null ? Number(row.strategy_tranche) : legacyTrancheFromNotes(row.notes)
          if (!(tranche && tranche >= 1 && tranche <= config.trancheCount)) unassignedBuysThisCycle++
        }
      } else {
        batchRunQuantity = Math.max(0, batchRunQuantity - quantity)
        if (batchRunQuantity <= 1e-9) unassignedBuysThisCycle = 0
      }
    }

    const soxlBars = (soxlDaily.value ?? []).map((bar) => ({
      timestamp: bar.t,
      open: bar.c,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: 0,
      isClosed: true,
    }))
    const soxlAtrPercent = calculateAtrPercent(soxlBars, 14)
    const soxlAtr14d = soxlAtrPercent === null ? null : (soxlAtrPercent / 100) * (soxlBars.at(-1)?.close ?? soxlQuote.price)
    const soxlPeakPriceSinceEntry = soxlBars
      .filter((bar) => !holdingCycleStartDate || bar.timestamp.slice(0, 10) >= holdingCycleStartDate.slice(0, 10))
      .reduce((peak, bar) => Math.max(peak, bar.high), soxlQuote.price)

    // 6. Run strategy engine
    const strategyState = evaluateSoxlSniperStrategy({
      analysis: indicators,
      soxlQuote,
      totalPortfolioValue,
      soxlQuantity,
      soxlCostBasis,
      cashAvailable,
      executedTranches,
      maxDrawdownSincePeak,
      sniperActivatedAt,
      cycleBoughtQty,
      cycleSoldQty,
      macroVerdict: macro.verdict,
      soxxStale: soxxQuote.isStale || allBars.length === 0 || weekly.stale || soxxDaily.stale,
      macroStale: [tnx, irx, vix, hyg, ief, dxy, qqq, unemp, tsmc].some((x) => x.stale),
      config,
      emergencyFundAmount: settings.emergencyFundAmount,
      exchangeRate,
      volatility20dPercent: indicators.volatility20dPercent,
      soxlPeakPriceSinceEntry,
      soxlAtr14d,
      unassignedBuysThisCycle,
    })

    if (cyclePeak > 0 && peakDate) {
      await sqlite.run(
        `INSERT INTO soxl_cycle_state (id, cycle_peak, cycle_peak_date, sniper_activated_at, max_drawdown_since_peak, updated_at)
         VALUES ('default', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cycle_peak = excluded.cycle_peak, cycle_peak_date = excluded.cycle_peak_date,
           sniper_activated_at = excluded.sniper_activated_at, max_drawdown_since_peak = excluded.max_drawdown_since_peak,
           updated_at = excluded.updated_at`,
        [cyclePeak, peakDate, sniperActivatedAt, maxDrawdownSincePeak, new Date().toISOString()]
      )
    }

    // 7. 週線圖表序列：SOXX 收盤 + 10W/40W 均線（用完整歷史滾動計算，再取近 156 週；最新一根含即時報價）
    const chartBars = applyLiveQuoteToBars(allBars, soxxQuote)
    const rollingMa = (i: number, n: number) => {
      if (i + 1 < n) return null
      let sum = 0
      for (let k = i - n + 1; k <= i; k++) sum += chartBars[k].close
      return Number((sum / n).toFixed(2))
    }
    const weeklySeries = chartBars
      .map((bar, i) => ({
        t: String(bar.timestamp).slice(0, 10),
        close: Number(bar.close.toFixed(2)),
        ma10w: rollingMa(i, 10),
        ma40w: rollingMa(i, 40),
      }))
      .slice(-156)

    return NextResponse.json({
      indicators,
      strategyState,
      weeklySeries,
      soxxQuote,
      soxlQuote,
      config,
      exchangeRate,
      marketUsdTwd,
      cycle: {
        peak: cyclePeak,
        peakDate,
        maxDrawdownSincePeak,
        lowDate,
        sniperActivatedAt,
        intervalWeeks: strategyState.effectiveIntervalWeeks,
        soxxPeakTo200w,
      },
      macro,
      macroSources: [
        { name: 'BLS 失業率', updatedAt: unemp.updatedAt, observedAt: unemp.observedAt, stale: unemp.stale, refreshFailed: unemp.refreshFailed },
        { name: 'FinMind 台積電營收', updatedAt: tsmc.updatedAt, observedAt: tsmc.observedAt, stale: tsmc.stale, refreshFailed: tsmc.refreshFailed },
        { name: 'Yahoo 殖利率／VIX／HYG／IEF', updatedAt: vix.updatedAt, stale: vix.stale || hyg.stale, refreshFailed: vix.refreshFailed || hyg.refreshFailed },
        { name: 'Yahoo SOXX 週 K', updatedAt: weekly.updatedAt, stale: weekly.stale, refreshFailed: weekly.refreshFailed },
      ],
    })
  } catch (error: any) {
    console.error('SOXL Strategy API error:', error)
    return NextResponse.json({ error: error.message || 'Strategy evaluation failed' }, { status: 500 })
  }
}

/**
 * 人工確認後寫入 SOXL 買賣：
 * - 匯率讀「系統設定」portfolio_settings.exchange_rate（不再寫死 32.5）
 * - 買進必須指定批次（結構化寫入 transactions.strategy_tranche），本輪不可重複執行同一批，且買後不得超過持倉上限
 * - 賣出不可超過持有量，並寫入已實現損益
 * - 找不到 SOXL 分類時建立正式分類（不再寫入不存在的 'default_cat'）
 */
export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '').toUpperCase()
    const quantity = Number(body.quantity)
    const price = Number(body.price)
    const tranche = body.tranche == null ? null : Number(body.tranche)
    const exitTier = body.exitTier == null ? null : Number(body.exitTier)
    const notes = typeof body.notes === 'string' ? body.notes : ''

    if (action !== 'BUY' && action !== 'SELL') {
      return NextResponse.json({ error: 'action 必須是 BUY 或 SELL' }, { status: 400 })
    }
    if (!(Number.isFinite(quantity) && quantity > 0) || !(Number.isFinite(price) && price > 0)) {
      return NextResponse.json({ error: '股數與價格必須大於 0' }, { status: 400 })
    }

    const settings = await loadPortfolioSettings()
    const config = await loadSoxlConfig(settings)
    const exchangeRate = settings.exchangeRate

    if (action === 'BUY' && !(tranche !== null && Number.isInteger(tranche) && tranche >= 1 && tranche <= config.trancheCount)) {
      return NextResponse.json({ error: `買進必須指定第 1～${config.trancheCount} 批` }, { status: 400 })
    }

    const now = new Date().toISOString()
    const today = now.split('T')[0]
    const statements: Statement[] = []

    let soxlAsset = await sqlite.get<any>("SELECT * FROM assets WHERE UPPER(symbol) = 'SOXL'")
    if (!soxlAsset) {
      if (action === 'SELL') {
        return NextResponse.json({ error: '目前沒有 SOXL 持倉，無法賣出' }, { status: 400 })
      }
      let cat = await sqlite.get<any>("SELECT id FROM categories WHERE name LIKE '%SOXL%' ORDER BY sort_order LIMIT 1")
      if (!cat) {
        const used = (await sqlite.all<{ color: string }>('SELECT color FROM categories')).map((c) => c.color)
        const maxOrder = await sqlite.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM categories')
        cat = { id: uuidv4() }
        statements.push({
          sql: `INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
                VALUES (?, 'SOXL 機會預備金', ?, ?, ?, ?, ?)`,
          args: [cat.id, getNextColor(used), Number(maxOrder?.m ?? 0) + 1, config.maxPositionPercent, now, now],
        })
      }
      soxlAsset = { id: uuidv4(), symbol: 'SOXL', quantity: 0, cost_per_unit: 0, current_price: null, currency: 'USD', category_id: cat.id }
      statements.push({
        sql: `INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
              VALUES (?, ?, 'SOXL', '半導體三倍槓桿', 0, 0, 0, 'USD', ?, ?)`,
        args: [soxlAsset.id, cat.id, now, now],
      })
    }

    if (action === 'BUY') {
      // GET 與 POST 使用相同的高點日期與持倉歸零重設口徑。
      const cycleState = await sqlite.get<{ cycle_peak_date: string }>(
        "SELECT cycle_peak_date FROM soxl_cycle_state WHERE id = 'default'"
      )
      const cyclePeakDate = cycleState?.cycle_peak_date ?? '1970-01-01'
      const txs = await sqlite.all<CycleTransaction>(
        "SELECT type, quantity, strategy_tranche, notes, date, created_at FROM transactions WHERE UPPER(symbol) = 'SOXL' AND date >= ? AND type IN ('BUY','SELL','INITIAL_BALANCE') ORDER BY date, created_at",
        [cyclePeakDate.slice(0, 10)]
      )
      const cycleTranches = new Set(getExecutedTranchesSinceCyclePeak(txs, cyclePeakDate, config.trancheCount))
      if (Number(soxlAsset.quantity) > 0 && cycleTranches.has(tranche as number)) {
        return NextResponse.json({ error: `第 ${tranche} 批在目前持倉週期已執行過，不可重複買進` }, { status: 409 })
      }

      // 上限檢查：用現金買進時總資產不變（預備金現金轉成 SOXL），分母用目前總資產
      const allAssets = await sqlite.all<any>('SELECT * FROM assets')
      const { total } = portfolioInUsd(allAssets, exchangeRate)
      const holdingAfter = ((Number(soxlAsset.quantity) || 0) + quantity) * price
      const denominator = Math.max(total, holdingAfter)
      const weightAfter = denominator > 0 ? (holdingAfter / denominator) * 100 : 100
      if (weightAfter > config.maxPositionPercent + 0.05) {
        return NextResponse.json(
          {
            error: `買進後 SOXL 會占總資產 ${weightAfter.toFixed(2)}%，超過 ${config.maxPositionPercent}% 上限，請減少股數`,
            weightAfter,
          },
          { status: 400 }
        )
      }
    }

    let result
    try {
      result = applyTrade(
        { quantity: Number(soxlAsset.quantity) || 0, costPerUnit: Number(soxlAsset.cost_per_unit) || 0 },
        { type: action as 'BUY' | 'SELL', quantity, price, fee: 0 }
      )
    } catch (err) {
      if (err instanceof LedgerError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    const label = action === 'BUY' ? `第 ${tranche} 批進場` : exitTier ? `第 ${exitTier} 批停利` : '賣出'
    statements.push({
      sql: `
        INSERT INTO strategy_signals (
          id, strategy_name, signal_type, symbol, price, indicator_values,
          trigger_condition, recommended_action, is_confirmed, status, created_at, executed_at
        ) VALUES (?, 'SOXL_SNIPER', ?, 'SOXL', ?, ?, ?, ?, 1, 'EXECUTED', ?, ?)
      `,
      args: [
        uuidv4(),
        action === 'BUY' ? 'BUY_CANDIDATE' : 'SELL_CANDIDATE',
        price,
        JSON.stringify({ tranche, exitTier, exchangeRate, notes }),
        notes || `人工確認 SOXL ${label}`,
        `以單價 $${price} ${action === 'BUY' ? '買進' : '賣出'} ${quantity} 股`,
        now,
        now,
      ],
    })

    const txId = uuidv4()
    statements.push({
      sql: `
        INSERT INTO transactions (
          id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate,
          realized_pnl, notes, strategy_tranche, created_at
        ) VALUES (?, ?, 'SOXL', ?, ?, ?, ?, 0, 'USD', ?, ?, ?, ?, ?)
      `,
      args: [
        txId,
        soxlAsset.id,
        action,
        today,
        quantity,
        price,
        exchangeRate,
        result.realizedPnl,
        notes || `SOXL 狙擊策略人工確認：${label}`,
        action === 'BUY' ? tranche : null,
        now,
      ],
    })

    statements.push({
      sql: 'UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?',
      args: [result.position.quantity, result.position.costPerUnit, now, soxlAsset.id],
    })

    // 訊號、交易紀錄、持倉更新一次寫入（全部成功或全部不生效）
    await sqlite.batch(statements)

    return NextResponse.json({
      success: true,
      message: `成功執行 SOXL ${action === 'BUY' ? '買進' : '賣出'}（${quantity} 股 @ $${price}，匯率 ${exchangeRate}）`,
      transactionId: txId,
      realizedPnl: result.realizedPnl,
      position: result.position,
      exchangeRate,
    })
  } catch (error: any) {
    console.error('Failed to execute SOXL strategy action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
