import { NextResponse } from 'next/server'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { loadPortfolioSettings } from '@/lib/strategies/config-loader'
import {
  getYahooCloses,
  getBtcMvrv,
  getFearGreed,
  getMstrBtcHoldings,
  getMstrDilutedShares,
} from '@/lib/market-data/external-sources'
import { scoreCycle, decideAllocation, PHASE_INFO, calculateEvMnav, calculateRatioZScore } from '@/lib/strategies/btc-cycle'

export const dynamic = 'force-dynamic'

/** 全自動：抓報價與鏈上指標 → 週期分數 → MSTR/BTC 目標比例 → 加減碼燈號 */
export async function GET() {
  try {
    await ensureTablesExist()
    const settings = await loadPortfolioSettings()

    const [btcW, btcD, mstrD, mvrv, fng, holdings, shares, twd] = await Promise.all([
      getYahooCloses('BTC-USD', '10y', '1wk'), // 200 週均線需要約 4 年，圖表再往前 3 年
      getYahooCloses('BTC-USD', '1y', '1d', 5 * 60),
      getYahooCloses('MSTR', '1y', '1d', 5 * 60),
      getBtcMvrv(),
      getFearGreed(),
      getMstrBtcHoldings(),
      getMstrDilutedShares(),
      getYahooCloses('TWD=X', '5d', '1d', 6 * 3600),
    ])

    const btcDaily = btcD.value || []
    const mstrDaily = mstrD.value || []
    const btcPrice = btcDaily.at(-1)?.c ?? btcW.value?.at(-1)?.c ?? 0
    const mstrPrice = mstrDaily.at(-1)?.c ?? 0
    const usdTwd = twd.value?.at(-1)?.c ?? 32.5

    const cycle = scoreCycle({
      now: new Date(),
      btcPrice,
      btcWeeklyCloses: (btcW.value || []).map((p) => p.c),
      btcDailyCloses: btcDaily.map((p) => p.c),
      mvrv: mvrv.value?.at(-1)?.c ?? null,
      fearGreed: fng.value?.[0]?.value ?? null,
      stale: { price: btcD.stale || btcW.stale, mvrv: mvrv.stale, fearGreed: fng.stale },
    })

    // mNAV = MSTR 市值 ÷ 持有 BTC 價值（市值用 SEC 稀釋後股數估算，未含債務與特別股）
    const btcHeld = holdings.value
    const reportedDilutedShares = shares.value?.shares ?? null
    const hasDilutedSharesOverride =
      settings.mstrDilutedSharesOverride != null &&
      Number.isFinite(settings.mstrDilutedSharesOverride) &&
      settings.mstrDilutedSharesOverride > 0
    const dilutedShares = hasDilutedSharesOverride ? settings.mstrDilutedSharesOverride : reportedDilutedShares
    const mstrMarketCap = dilutedShares ? dilutedShares * mstrPrice : null
    const btcNav = btcHeld ? btcHeld * btcPrice : null
    const mnav = mstrMarketCap && btcNav ? mstrMarketCap / btcNav : null
    const evMnav =
      dilutedShares != null && btcHeld != null
        ? calculateEvMnav({
            mstrPrice,
            dilutedShares,
            btcHeld,
            btcPrice,
            netDebtUsd: settings.mstrNetDebtUsd,
            preferredStockUsd: settings.mstrPreferredStockUsd,
          })
        : null

    const btcByDate = new Map(btcDaily.map((p) => [p.t.slice(0, 10), p.c]))
    const ratioSeries = mstrDaily.flatMap((point) => {
      const btcClose = btcByDate.get(point.t.slice(0, 10))
      return btcClose != null && btcClose > 0 ? [point.c / btcClose] : []
    })

    // 持倉（資產表各幣別換成美元）
    const assets = await sqlite.all<any>('SELECT symbol, quantity, current_price, cost_per_unit, currency FROM assets')
    let totalUsd = 0
    let btcQty = 0
    let mstrQty = 0
    for (const a of assets) {
      const sym = String(a.symbol).toUpperCase()
      let price = a.current_price || a.cost_per_unit || 0
      if (sym === 'BTC' || sym === 'MSTR') {
        // 多筆（不同帳戶）累加；已換成美元即時價，不再除匯率
        if (sym === 'BTC') btcQty += a.quantity
        else mstrQty += a.quantity
        totalUsd += a.quantity * (sym === 'BTC' ? btcPrice : mstrPrice)
        continue
      }
      const v = a.quantity * price
      totalUsd += a.currency === 'TWD' ? v / usdTwd : v
    }

    const allocation = decideAllocation({
      cycleScore: cycle.score,
      reliable: cycle.reliable,
      anyStale: [btcD, btcW, mstrD, mvrv, fng, holdings, ...(hasDilutedSharesOverride ? [] : [shares])].some((x) => x.stale),
      mnav: evMnav,
      btcValueUsd: btcQty * btcPrice,
      mstrValueUsd: mstrQty * mstrPrice,
      totalPortfolioUsd: totalUsd,
      btcBelow200dMa: cycle.ma200d != null && btcPrice < cycle.ma200d,
      mstrBtcRatioFalling: (() => {
        const recent = ratioSeries.slice(-20)
        return recent.length === 20 && recent.at(-1)! < recent.reduce((sum, ratio) => sum + ratio, 0) / recent.length
      })(),
      mstrBtcZScore60d: calculateRatioZScore(ratioSeries),
    })

    // 圖表：BTC 週線＋200 週均線（回傳完整週線，前端依 1Y / 3Y / ALL 切片）
    const wk = btcW.value || []
    const chart = wk.map((p, i) => {
      const win = wk.slice(Math.max(0, i - 199), i + 1)
      return {
        t: p.t.slice(0, 10),
        price: Math.round(p.c),
        ma200w: win.length === 200 ? Math.round(win.reduce((a, b) => a + b.c, 0) / 200) : null,
      }
    })

    // MSTR / BTC 比值（近 1 年，日線對齊日期）
    const ratioChart = mstrDaily
      .map((p) => {
        const b = btcByDate.get(p.t.slice(0, 10))
        return b ? { t: p.t.slice(0, 10), ratio: Number(((p.c / b) * 1e4).toFixed(3)) } : null
      })
      .filter(Boolean)

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      prices: {
        btc: btcPrice,
        mstr: mstrPrice,
        btcChangePct: btcDaily.length > 1 ? (btcPrice / btcDaily.at(-2)!.c - 1) * 100 : 0,
        mstrChangePct: mstrDaily.length > 1 ? (mstrPrice / mstrDaily.at(-2)!.c - 1) * 100 : 0,
        usdTwd,
      },
      cycle: {
        score: cycle.score,
        phase: cycle.phase,
        phaseInfo: PHASE_INFO[cycle.phase],
        indicators: cycle.indicators,
        ma200w: cycle.ma200w,
        ma200d: cycle.ma200d,
        reliable: cycle.reliable,
      },
      mstr: {
        mnav,
        evMnav,
        btcHeld,
        dilutedShares,
        reportedDilutedShares,
        mstrDilutedSharesOverride: settings.mstrDilutedSharesOverride,
        zScore60d: calculateRatioZScore(ratioSeries),
        sharesPeriodEnd: shares.value?.periodEnd ?? null,
        marketCap: mstrMarketCap,
        btcNav,
        mnavLabel: allocation.mnavLabel,
        mnavAdjust: allocation.mnavAdjust,
      },
      allocation,
      holdings: { btcQty, mstrQty, totalUsd },
      charts: { btc: chart, ratio: ratioChart },
      sources: [
        { name: 'Yahoo Finance（報價、K 線）', updatedAt: btcD.updatedAt, stale: btcD.stale },
        { name: 'CoinMetrics（MVRV）', updatedAt: mvrv.updatedAt, stale: mvrv.stale },
        { name: 'alternative.me（恐懼貪婪）', updatedAt: fng.updatedAt, stale: fng.stale },
        { name: 'CoinGecko（MSTR 持幣）', updatedAt: holdings.updatedAt, stale: holdings.stale },
        { name: 'SEC（MSTR 股數）', updatedAt: shares.updatedAt, stale: shares.stale },
      ],
    })
  } catch (error: any) {
    console.error('BTC/MSTR Strategy API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
