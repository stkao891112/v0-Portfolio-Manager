import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { analyzeSoxxIndicators } from '@/lib/strategies/indicators'
import { evaluateSoxlSniperStrategy } from '@/lib/strategies/soxl-engine'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    ensureTablesExist()

    // 1. Fetch SOXX weekly bars & SOXL quote
    const [soxxBars, soxlQuote, soxxQuote] = await Promise.all([
      marketService.getWeeklyBars('SOXX', 104),
      marketService.getQuote('SOXL'),
      marketService.getQuote('SOXX'),
    ])

    // 2. Fetch strategy settings from SQLite
    const settingRow = sqlite
      .prepare("SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'")
      .get() as any

    const config = settingRow ? JSON.parse(settingRow.config_json) : { cyclePeakSoxx: 320.0 }

    // 3. Perform indicator analysis
    const indicators = analyzeSoxxIndicators(soxxBars, config.cyclePeakSoxx, config.cycleAnchorDate)

    // 4. Fetch SOXL holding from assets table
    const soxlAsset = sqlite.prepare("SELECT * FROM assets WHERE symbol = 'SOXL'").get() as any
    const soxlQuantity = soxlAsset ? soxlAsset.quantity : 0
    const soxlCostBasis = soxlAsset ? soxlAsset.cost_per_unit : 0

    // Fetch total portfolio value
    const allAssets = sqlite.prepare('SELECT * FROM assets').all() as any[]
    let totalPortfolioValue = 0
    let cashAvailable = 0

    for (const a of allAssets) {
      const price = a.current_price || a.cost_per_unit || 0
      const val = a.quantity * price
      totalPortfolioValue += val
      if (a.symbol.includes('CASH') || a.symbol.includes('BUFFER')) {
        cashAvailable += val
      }
    }

    // Fetch executed tranches from transactions table
    const executedRows = sqlite
      .prepare("SELECT notes FROM transactions WHERE symbol = 'SOXL' AND type = 'BUY'")
      .all() as any[]

    const executedTranches: number[] = []
    for (const row of executedRows) {
      if (row.notes?.includes('第1批')) executedTranches.push(1)
      if (row.notes?.includes('第2批')) executedTranches.push(2)
      if (row.notes?.includes('第3批')) executedTranches.push(3)
      if (row.notes?.includes('第4批')) executedTranches.push(4)
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
    })

    return NextResponse.json({
      indicators,
      strategyState,
      soxxQuote,
      soxlQuote,
    })
  } catch (error: any) {
    console.error('SOXL Strategy API error:', error)
    return NextResponse.json({ error: error.message || 'Strategy evaluation failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { action, tranche, quantity, price, notes } = body

    if (!action || !quantity || !price) {
      return NextResponse.json({ error: 'Missing action, quantity, or price' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const txId = uuidv4()
    const signalId = uuidv4()

    // Find or create SOXL asset row
    let soxlAsset = sqlite.prepare("SELECT * FROM assets WHERE symbol = 'SOXL'").get() as any
    if (!soxlAsset) {
      const cat = sqlite.prepare("SELECT id FROM categories WHERE name LIKE '%SOXL%' LIMIT 1").get() as any
      const catId = cat ? cat.id : 'default_cat'
      sqlite.prepare(`
        INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
        VALUES (?, ?, 'SOXL', '半導體三倍槓桿', 0, 0, 0, 'USD', ?, ?)
      `).run(uuidv4(), catId, now, now)
      soxlAsset = sqlite.prepare("SELECT * FROM assets WHERE symbol = 'SOXL'").get() as any
    }

    // Record human confirmation execution in strategy_signals
    sqlite.prepare(`
      INSERT INTO strategy_signals (
        id, strategy_name, signal_type, symbol, price, indicator_values,
        trigger_condition, recommended_action, is_confirmed, status, created_at, executed_at
      ) VALUES (?, 'SOXL_SNIPER', ?, 'SOXL', ?, ?, ?, ?, 1, 'EXECUTED', ?, ?)
    `).run(
      signalId,
      action === 'BUY' ? 'BUY_CANDIDATE' : 'SELL_CANDIDATE',
      price,
      JSON.stringify({ tranche, notes }),
      notes || `手動執行 ${action} 第 ${tranche} 批次`,
      `以單價 $${price} 執行 ${action} ${quantity} 股`,
      now,
      now
    )

    // Record in transactions
    sqlite.prepare(`
      INSERT INTO transactions (
        id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
      ) VALUES (?, ?, 'SOXL', ?, ?, ?, ?, 0, 'USD', 32.5, ?, ?)
    `).run(
      txId,
      soxlAsset.id,
      action,
      now.split('T')[0],
      quantity,
      price,
      notes || `SOXL 狙擊策略人工確認: ${action} 第 ${tranche} 批`,
      now
    )

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

    sqlite.prepare(`
      UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?
    `).run(newQty, newCost, now, soxlAsset.id)

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
