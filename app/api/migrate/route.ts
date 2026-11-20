import { NextResponse } from 'next/server'
import { sqlite, type Statement } from '@/lib/db/client'
import { ensureTablesExist, DEFAULT_PORTFOLIO_SETTINGS } from '@/lib/db/init'
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
    const body = await request.json().catch(() => ({}))
    const { categories = [], displayCurrency, exchangeRate, confirmOverwrite } = body

    // 這支 API 會清空現有分類與資產再匯入，只允許使用者在「系統設定」明確按下並確認後呼叫
    if (confirmOverwrite !== true) {
      return NextResponse.json(
        { error: '遷移會覆蓋資料庫現有的分類與資產，必須帶 confirmOverwrite: true 才會執行' },
        { status: 400 }
      )
    }

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

      // 2. 只更新幣別與匯率（有送來且合法才改）；其他設定（每月投入、緊急預備金、SOXL 參數）保留原值
      {
        sql: `
          INSERT INTO portfolio_settings (
            id, display_currency, exchange_rate, monthly_investment_amount,
            emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
          ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_currency = COALESCE(?, portfolio_settings.display_currency),
            exchange_rate = COALESCE(?, portfolio_settings.exchange_rate),
            updated_at = excluded.updated_at
        `,
        args: [
          displayCurrency === 'USD' ? 'USD' : 'TWD',
          Number(exchangeRate) > 0 ? Number(exchangeRate) : DEFAULT_PORTFOLIO_SETTINGS.exchangeRate,
          DEFAULT_PORTFOLIO_SETTINGS.monthlyInvestmentAmount,
          DEFAULT_PORTFOLIO_SETTINGS.emergencyFundAmount,
          DEFAULT_PORTFOLIO_SETTINGS.soxlReserveTargetPercent,
          DEFAULT_PORTFOLIO_SETTINGS.soxlMaxPositionPercent,
          now,
          displayCurrency === 'USD' || displayCurrency === 'TWD' ? displayCurrency : null,
          Number(exchangeRate) > 0 ? Number(exchangeRate) : null,
        ],
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
