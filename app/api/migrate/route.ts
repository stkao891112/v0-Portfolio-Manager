import { NextResponse } from 'next/server'
import { db, sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    ensureTablesExist()
    const countRow = sqlite.prepare('SELECT count(*) as count FROM categories').get() as { count: number }
    return NextResponse.json({
      hasData: countRow.count > 0,
      categoriesCount: countRow.count,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { categories = [], displayCurrency = 'TWD', exchangeRate = 32.5 } = body

    if (!Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json({ error: 'No categories provided' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // Transactional migration
    const migrateTx = sqlite.transaction(() => {
      // 1. Wipe existing categories & assets to do clean import
      sqlite.prepare('DELETE FROM assets').run()
      sqlite.prepare('DELETE FROM categories').run()

      // 2. Update settings
      sqlite.prepare(`
        INSERT OR REPLACE INTO portfolio_settings (
          id, display_currency, exchange_rate, monthly_investment_amount,
          emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
        ) VALUES ('default', ?, ?, 20000, 0, 10.0, 5.0, ?)
      `).run(displayCurrency, exchangeRate, now)

      const insertCat = sqlite.prepare(`
        INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      const insertAsset = sqlite.prepare(`
        INSERT INTO assets (
          id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertTx = sqlite.prepare(`
        INSERT INTO transactions (
          id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
        ) VALUES (?, ?, ?, 'INITIAL_BALANCE', ?, ?, ?, 0, ?, 1.0, '從 LocalStorage 遷移初始持倉', ?)
      `)

      let sortOrder = 1
      for (const cat of categories) {
        const catId = cat.id || uuidv4()
        const catTarget = cat.assets?.reduce((sum: number, a: any) => sum + (Number(a.targetPercent) || 0), 0) || 0
        insertCat.run(catId, cat.name, cat.color || 'oklch(0.72 0.19 180)', sortOrder++, catTarget, now, now)

        if (Array.isArray(cat.assets)) {
          for (const a of cat.assets) {
            const assetId = a.id || uuidv4()
            const sym = (a.symbol || '').toUpperCase()
            const qty = Number(a.quantity) || 0
            const cost = Number(a.costPerUnit) || 0
            const cur = a.currency || 'TWD'
            const target = Number(a.targetPercent) || 0

            insertAsset.run(assetId, catId, sym, sym, target, qty, cost, cur, now, now)

            if (qty > 0) {
              insertTx.run(uuidv4(), assetId, sym, now.split('T')[0], qty, cost, cur, now)
            }
          }
        }
      }
    })

    migrateTx()

    return NextResponse.json({
      success: true,
      migratedCategories: categories.length,
      message: '成功從 LocalStorage 遷移資產組合至 SQLite 本機資料庫',
    })
  } catch (error: any) {
    console.error('Migration failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
