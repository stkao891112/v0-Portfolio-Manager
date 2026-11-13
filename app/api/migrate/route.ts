import { NextResponse } from 'next/server'
import { sqlite, type Statement } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    await ensureTablesExist()
    const countRow = await sqlite.get<{ count: number }>('SELECT count(*) as count FROM categories')
    const count = Number(countRow?.count ?? 0)
    return NextResponse.json({
      hasData: count > 0,
      categoriesCount: count,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json()
    const { categories = [], displayCurrency = 'TWD', exchangeRate = 32.5 } = body

    if (!Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json({ error: 'No categories provided' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // Transactional migration：所有指令一次寫入（全部成功或全部不生效）
    const statements: Statement[] = [
      // 1. Wipe existing categories & assets to do clean import
      //    （交易紀錄保留但解除關聯，等同原本外鍵的 ON DELETE SET NULL）
      { sql: 'UPDATE transactions SET asset_id = NULL WHERE asset_id IS NOT NULL' },
      { sql: 'DELETE FROM assets' },
      { sql: 'DELETE FROM categories' },

      // 2. Update settings
      {
        sql: `
          INSERT OR REPLACE INTO portfolio_settings (
            id, display_currency, exchange_rate, monthly_investment_amount,
            emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
          ) VALUES ('default', ?, ?, 20000, 0, 10.0, 5.0, ?)
        `,
        args: [displayCurrency, exchangeRate, now],
      },
    ]

    const insertCatSql = `
      INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `

    const insertAssetSql = `
      INSERT INTO assets (
        id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const insertTxSql = `
      INSERT INTO transactions (
        id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
      ) VALUES (?, ?, ?, 'INITIAL_BALANCE', ?, ?, ?, 0, ?, 1.0, '從 LocalStorage 遷移初始持倉', ?)
    `

    let sortOrder = 1
    for (const cat of categories) {
      const catId = cat.id || uuidv4()
      const catTarget = cat.assets?.reduce((sum: number, a: any) => sum + (Number(a.targetPercent) || 0), 0) || 0
      statements.push({
        sql: insertCatSql,
        args: [catId, cat.name, cat.color || 'oklch(0.72 0.19 180)', sortOrder++, catTarget, now, now],
      })

      if (Array.isArray(cat.assets)) {
        for (const a of cat.assets) {
          const assetId = a.id || uuidv4()
          const sym = (a.symbol || '').toUpperCase()
          const qty = Number(a.quantity) || 0
          const cost = Number(a.costPerUnit) || 0
          const cur = a.currency || 'TWD'
          const target = Number(a.targetPercent) || 0

          statements.push({
            sql: insertAssetSql,
            args: [assetId, catId, sym, sym, target, qty, cost, cur, now, now],
          })

          if (qty > 0) {
            statements.push({
              sql: insertTxSql,
              args: [uuidv4(), assetId, sym, now.split('T')[0], qty, cost, cur, now],
            })
          }
        }
      }
    }

    await sqlite.batch(statements)

    return NextResponse.json({
      success: true,
      migratedCategories: categories.length,
      message: '成功從 LocalStorage 遷移資產組合至資料庫',
    })
  } catch (error: any) {
    console.error('Migration failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
