import { NextResponse } from 'next/server'
import { db, sqlite } from '@/lib/db/client'
import { assets } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { categoryId, symbol, name, targetPercent = 0, quantity = 0, costPerUnit = 0, currency = 'TWD' } = body

    if (!categoryId || !symbol) {
      return NextResponse.json({ error: 'categoryId and symbol are required' }, { status: 400 })
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    sqlite.prepare(`
      INSERT INTO assets (
        id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      categoryId,
      symbol.toUpperCase(),
      name || symbol.toUpperCase(),
      targetPercent,
      quantity,
      costPerUnit,
      currency,
      now,
      now
    )

    // Also record initial transaction if quantity > 0
    if (quantity > 0) {
      sqlite.prepare(`
        INSERT INTO transactions (
          id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
        ) VALUES (?, ?, ?, 'INITIAL_BALANCE', ?, ?, ?, 0, ?, 1.0, '初始持倉記錄', ?)
      `).run(uuidv4(), id, symbol.toUpperCase(), now.split('T')[0], quantity, costPerUnit, currency, now)
    }

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { id, targetPercent, quantity, costPerUnit, currency, name } = body

    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
    }

    const existing = sqlite.prepare('SELECT * FROM assets WHERE id = ?').get(id) as any
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    sqlite.prepare(`
      UPDATE assets
      SET target_percent = ?, quantity = ?, cost_per_unit = ?, currency = ?, name = ?, updated_at = ?
      WHERE id = ?
    `).run(
      targetPercent ?? existing.target_percent,
      quantity ?? existing.quantity,
      costPerUnit ?? existing.cost_per_unit,
      currency ?? existing.currency,
      name ?? existing.name,
      now,
      id
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
    }

    sqlite.prepare('DELETE FROM assets WHERE id = ?').run(id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
