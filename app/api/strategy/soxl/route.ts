import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { analyzeSoxxIndicators } from '@/lib/strategies/indicators'
import { evaluateSoxlSniperStrategy, SOXL_ACTIVATE_DRAWDOWN, SOXL_INTERVAL_WEEKS } from '@/lib/strategies/soxl-engine'
import { sqlite, type Statement } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'
import { getYahooCloses, getYahooDaily, getUsUnemployment, getTsmcMonthlyRevenue } from '@/lib/market-data/external-sources'
import { evaluateMacro } from '@/lib/strategies/macro-check'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureTablesExist()

    // 1. 報價、10 年週 K（200 週均線用）、總經資料，全部自動抓
    const [allBars, soxxDaily, soxlQuote, soxxQuote, tnx, irx, vix, hyg, ief, unemp, tsmc, twd] = await Promise.all([
      marketService.getWeeklyBars('SOXX', 520),
      getYahooDaily('SOXX', '3y'),
      marketService.getQuote('SOXL'),
      marketService.getQuote('SOXX'),
      getYahooCloses('^TNX', '1mo', '1d', 3600),
      getYahooCloses('^IRX', '1mo', '1d', 3600),
      getYahooCloses('^VIX', '1mo', '1d', 15 * 60),
      getYahooCloses('HYG', '6mo', '1d', 3600),
      getYahooCloses('IEF', '6mo', '1d', 3600),
      getUsUnemployment(),
      getTsmcMonthlyRevenue(),
      getYahooCloses('TWD=X', '5d', '1d', 6 * 3600),
    ])

    // 2. 本輪高點：近 3 年「日收盤」最高點（已含分割還原）
    //    狙擊期：高點之後「盤中最低」第一次跌到 -40% 的日期即啟動；創新高時自動重置
    const daily = soxxDaily.value || []
    let peakIdx = -1
    daily.forEach((b, i) => {
      if (peakIdx < 0 || b.c > daily[peakIdx].c) peakIdx = i
    })
    const peakBar = peakIdx >= 0 ? { timestamp: daily[peakIdx].t, close: daily[peakIdx].c } : null
    const cyclePeak = peakBar?.close ?? 0
    const afterPeak = peakIdx >= 0 ? daily.slice(peakIdx) : []
    let lowAfterPeak = cyclePeak
    let lowDate: string | null = null
    let sniperActivatedAt: string | null = null
    for (const b of afterPeak) {
      if (b.l < lowAfterPeak) {
        lowAfterPeak = b.l
        lowDate = b.t
      }
      if (!sniperActivatedAt && cyclePeak > 0 && (b.l / cyclePeak - 1) * 100 <= SOXL_ACTIVATE_DRAWDOWN) {
        sniperActivatedAt = b.t
      }
    }
    const maxDrawdownSincePeak = cyclePeak > 0 ? (lowAfterPeak / cyclePeak - 1) * 100 : 0

    // 高點時的 200 週均線（判斷前一波是不是泡沫）：取高點日以前的 200 根週 K
    let soxxPeakTo200w: number | null = null
    if (peakBar) {
      const before = allBars.filter((b) => b.timestamp <= peakBar.timestamp)
      if (before.length >= 200) {
        const ma = before.slice(-200).reduce((a, b) => a + b.close, 0) / 200
        soxxPeakTo200w = peakBar.close / ma
      }
    }
    const recent = allBars.slice(-156)

    // 3. 技術指標（用即時價取代最後一根，讓回撤即時）
    const indicators = analyzeSoxxIndicators(recent, cyclePeak)

    // 4. 總經判斷
    const last = (s: { value: { c: number }[] | null }) => s.value?.at(-1)?.c ?? null
    const ratio = (h: typeof hyg.value, f: typeof ief.value, back: number) => {
      if (!h || !f || h.length <= back || f.length <= back) return null
      return h.at(-1 - back)!.c / f.at(-1 - back)!.c
    }
    const rNow = ratio(hyg.value, ief.value, 0)
    const r3m = ratio(hyg.value, ief.value, 63)
    const macro = evaluateMacro({
      unemployment: unemp.value?.map((r) => r.rate) ?? null,
      tnx: last(tnx),
      irx: last(irx),
      vix: last(vix),
      hygIefChange3m: rNow && r3m ? (rNow / r3m - 1) * 100 : null,
      tsmcRevenue: tsmc.value,
      soxxPeakTo200w,
    })
    const usdTwd = last(twd) ?? 32.5

    // 4. Fetch SOXL holding, all assets, and executed tranches
    const [soxlAsset, allAssets, executedRows] = await Promise.all([
      sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'SOXL'"),
      sqlite.all<any>('SELECT * FROM assets'),
      // 只算本輪高點之後的買進，上一輪執行過的批次不影響新一輪
      sqlite.all<any>("SELECT notes FROM transactions WHERE symbol = 'SOXL' AND type = 'BUY' AND date >= ?", [
        (peakBar?.timestamp ?? '1970-01-01').slice(0, 10),
      ]),
    ])
    const soxlQuantity = soxlAsset ? soxlAsset.quantity : 0
    const soxlCostBasis = soxlAsset ? soxlAsset.cost_per_unit : 0

    // Fetch total portfolio value
    let totalPortfolioValue = 0
    let cashAvailable = 0

    for (const a of allAssets) {
      const price = a.current_price || a.cost_per_unit || 0
      // 台幣資產換成美元，與 SOXL 同幣別比較
      const val = (a.quantity * price) / (a.currency === 'TWD' ? usdTwd : 1)
      totalPortfolioValue += val
      if (a.symbol.includes('CASH') || a.symbol.includes('BUFFER')) {
        cashAvailable += val
      }
    }

    // Executed tranches from transactions table
    // 備註格式為「第 1 批」或「第1批」都要認得
    const executedTranches: number[] = []
    for (const row of executedRows) {
      const m = String(row.notes || '').match(/第\s*([1-4])\s*批/)
      if (m) executedTranches.push(Number(m[1]))
    }

    // 5. Run strategy engine
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
      macroVerdict: macro.verdict,
      soxxStale: soxxQuote.isStale || allBars.length === 0 || soxxDaily.stale,
      macroStale: [tnx, irx, vix, hyg, ief, unemp, tsmc].some((x) => x.stale),
    })

    return NextResponse.json({
      indicators,
      strategyState,
      soxxQuote,
      soxlQuote,
      cycle: {
        peak: cyclePeak,
        peakDate: peakBar?.timestamp ?? null,
        maxDrawdownSincePeak,
        lowDate,
        sniperActivatedAt,
        intervalWeeks: SOXL_INTERVAL_WEEKS,
        soxxPeakTo200w,
      },
      macro,
      macroSources: [
        { name: 'BLS 失業率', updatedAt: unemp.updatedAt, stale: unemp.stale },
        { name: 'FinMind 台積電營收', updatedAt: tsmc.updatedAt, stale: tsmc.stale },
        { name: 'Yahoo 殖利率／VIX／HYG／IEF', updatedAt: vix.updatedAt, stale: vix.stale || hyg.stale },
      ],
    })
  } catch (error: any) {
    console.error('SOXL Strategy API error:', error)
    return NextResponse.json({ error: error.message || 'Strategy evaluation failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json()
    const { action, tranche, quantity, price, notes } = body

    if (!action || !quantity || !price) {
      return NextResponse.json({ error: 'Missing action, quantity, or price' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const txId = uuidv4()
    const signalId = uuidv4()

    // Find or create SOXL asset row
    let soxlAsset = await sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'SOXL'")
    if (!soxlAsset) {
      const cat = await sqlite.get<any>("SELECT id FROM categories WHERE name LIKE '%SOXL%' LIMIT 1")
      const catId = cat ? cat.id : 'default_cat'
      await sqlite.run(
        `
        INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
        VALUES (?, ?, 'SOXL', '半導體三倍槓桿', 0, 0, 0, 'USD', ?, ?)
      `,
        [uuidv4(), catId, now, now]
      )
      soxlAsset = await sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'SOXL'")
    }

    const statements: Statement[] = []

    // Record human confirmation execution in strategy_signals
    statements.push({
      sql: `
        INSERT INTO strategy_signals (
          id, strategy_name, signal_type, symbol, price, indicator_values,
          trigger_condition, recommended_action, is_confirmed, status, created_at, executed_at
        ) VALUES (?, 'SOXL_SNIPER', ?, 'SOXL', ?, ?, ?, ?, 1, 'EXECUTED', ?, ?)
      `,
      args: [
        signalId,
        action === 'BUY' ? 'BUY_CANDIDATE' : 'SELL_CANDIDATE',
        price,
        JSON.stringify({ tranche, notes }),
        notes || `手動執行 ${action} 第 ${tranche} 批次`,
        `以單價 $${price} 執行 ${action} ${quantity} 股`,
        now,
        now,
      ],
    })

    // Record in transactions
    statements.push({
      sql: `
        INSERT INTO transactions (
          id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
        ) VALUES (?, ?, 'SOXL', ?, ?, ?, ?, 0, 'USD', 32.5, ?, ?)
      `,
      args: [
        txId,
        soxlAsset.id,
        action,
        now.split('T')[0],
        quantity,
        price,
        notes || `SOXL 狙擊策略人工確認: ${action} 第 ${tranche} 批`,
        now,
      ],
    })

    // Update holding quantity & cost basis
    let newQty = soxlAsset.quantity
    let newCost = soxlAsset.cost_per_unit

    if (action === 'BUY') {
      const totalCostBefore = soxlAsset.quantity * soxlAsset.cost_per_unit
      const totalCostNew = quantity * price
      newQty = soxlAsset.quantity + quantity
      newCost = newQty > 0 ? (totalCostBefore + totalCostNew) / newQty : 0
    } else if (action === 'SELL') {
      newQty = Math.max(0, soxlAsset.quantity - quantity)
    }

    statements.push({
      sql: 'UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?',
      args: [newQty, newCost, now, soxlAsset.id],
    })

    // 訊號、交易紀錄、持倉更新一次寫入（全部成功或全部不生效）
    await sqlite.batch(statements)

    return NextResponse.json({
      success: true,
      message: `成功執行 SOXL ${action} 操作（${quantity} 股 @ $${price}）`,
      transactionId: txId,
    })
  } catch (error: any) {
    console.error('Failed to execute SOXL strategy action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
