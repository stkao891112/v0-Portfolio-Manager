import { NextResponse } from 'next/server'
import { db, sqlite } from '@/lib/db/client'
import { transactions, assets } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    ensureTablesExist()
    const all = await db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.createdAt)).limit(100)
    return NextResponse.json({ transactions: all })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { assetId, symbol, type, date, quantity, price, fee = 0, currency = 'TWD', exchangeRate = 1.0, notes } = body

    if (!symbol || !type || !date || quantity === undefined || price === undefined) {
      return NextResponse.json({ error: 'Missing required transaction fields' }, { status: 400 })
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    sqlite.prepare(`
      INSERT INTO transactions (
        id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      assetId || null,
      symbol.toUpperCase(),
      type,
      date,
      quantity,
      price,
      fee,
      currency,
      exchangeRate,
      notes || null,
      now
    )

    // If an assetId was provided, update asset holding quantity and cost basis
    if (assetId) {
      const existing = sqlite.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any
      if (existing) {
        let newQty = existing.quantity
        let newCost = existing.cost_per_unit

        if (type === 'BUY') {
          const totalCostBefore = existing.quantity * existing.cost_per_unit
          const totalCostNew = quantity * price + fee
          newQty = existing.quantity + quantity
          newCost = newQty > 0 ? (totalCostBefore + totalCostNew) / newQty : 0
        } else if (type === 'SELL') {
          newQty = Math.max(0, existing.quantity - quantity)
        }

        sqlite.prepare(`
          UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?
        `).run(newQty, newCost, now, assetId)
      }
    }

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
