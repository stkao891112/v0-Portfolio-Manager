import { NextResponse } from 'next/server'
import { sqlite, type Statement } from '@/lib/db/client'
import { isValidUuid } from '@/lib/ids'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => ({}))
    const { categoryId, symbol, name, targetPercent = 0, quantity = 0, costPerUnit = 0, currency = 'TWD', restore = false } = body

    if (!categoryId || !symbol || typeof symbol !== 'string') {
      return NextResponse.json({ error: 'categoryId and symbol are required' }, { status: 400 })
    }
    const nums = { targetPercent: Number(targetPercent), quantity: Number(quantity), costPerUnit: Number(costPerUnit) }
    if (Object.values(nums).some((v) => !Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: '目標比例、數量、成本不可為負數或非數字' }, { status: 400 })
    }
    if (currency !== 'TWD' && currency !== 'USD') {
      return NextResponse.json({ error: '幣別只能是 TWD 或 USD' }, { status: 400 })
    }
    const category = await sqlite.get('SELECT id FROM categories WHERE id = ?', [categoryId])
    if (!category) {
      return NextResponse.json({ error: '找不到指定的分類（可能已被刪除）' }, { status: 404 })
    }

    // 前端樂觀更新時產生的 UUID（或「復原刪除」帶回的原 id）合法且未被使用就沿用
    let id = isValidUuid(body.id) || (restore && typeof body.id === 'string' && body.id) ? body.id : uuidv4()
    if (await sqlite.get('SELECT id FROM assets WHERE id = ?', [id])) {
      if (restore) return NextResponse.json({ success: true, id }) // 已存在＝已復原過
      id = uuidv4()
    }
    const now = new Date().toISOString()
    const currentPrice = Number(body.currentPrice) > 0 ? Number(body.currentPrice) : null
    const priceUpdatedAt = currentPrice && typeof body.priceUpdatedAt === 'string' ? body.priceUpdatedAt : null

    const statements: Statement[] = [
      {
        sql: `
          INSERT INTO assets (
            id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency,
            current_price, price_updated_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          categoryId,
          symbol.trim().toUpperCase(),
          name || symbol.trim().toUpperCase(),
          nums.targetPercent,
          nums.quantity,
          nums.costPerUnit,
          currency,
          currentPrice,
          priceUpdatedAt,
          now,
          now,
        ],
      },
    ]

    // Also record initial transaction if quantity > 0
    // 「復原刪除」不重複寫入初始持倉交易（原本的交易紀錄仍在帳本）
    if (nums.quantity > 0 && nums.costPerUnit > 0 && !restore) {
      statements.push({
        sql: `
          INSERT INTO transactions (
            id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
          ) VALUES (?, ?, ?, 'INITIAL_BALANCE', ?, ?, ?, 0, ?, 1.0, '初始持倉記錄', ?)
        `,
        args: [uuidv4(), id, symbol.trim().toUpperCase(), now.split('T')[0], nums.quantity, nums.costPerUnit, currency, now],
      })
    }

    if (restore) {
      // 刪除資產時交易紀錄只解除關聯；復原時把同代號、未關聯的交易接回來
      statements.push({
        sql: 'UPDATE transactions SET asset_id = ? WHERE asset_id IS NULL AND UPPER(symbol) = ?',
        args: [id, symbol.trim().toUpperCase()],
      })
    }

    await sqlite.batch(statements)

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => ({}))
    const { id, targetPercent, quantity, costPerUnit, currency, name } = body

    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
    }
    for (const [label, v] of [['目標比例', targetPercent], ['數量', quantity], ['成本', costPerUnit]] as const) {
      if (v !== undefined && v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        return NextResponse.json({ error: `${label}不可為負數或非數字` }, { status: 400 })
      }
    }
    if (currency !== undefined && currency !== 'TWD' && currency !== 'USD') {
      return NextResponse.json({ error: '幣別只能是 TWD 或 USD' }, { status: 400 })
    }

    const existing = await sqlite.get<any>('SELECT * FROM assets WHERE id = ?', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    await sqlite.run(
      `
      UPDATE assets
      SET target_percent = ?, quantity = ?, cost_per_unit = ?, currency = ?, name = ?, updated_at = ?
      WHERE id = ?
    `,
      [
        targetPercent ?? existing.target_percent,
        quantity ?? existing.quantity,
        costPerUnit ?? existing.cost_per_unit,
        currency ?? existing.currency,
        name ?? existing.name,
        now,
        id,
      ]
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
    }

    // 交易紀錄保留，只解除與此資產的關聯（等同原本外鍵的 ON DELETE SET NULL）
    await sqlite.batch([
      { sql: 'UPDATE transactions SET asset_id = NULL WHERE asset_id = ?', args: [id] },
      { sql: 'DELETE FROM assets WHERE id = ?', args: [id] },
    ])
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
