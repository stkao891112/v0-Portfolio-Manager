import { NextResponse } from 'next/server'
import { getDb, sqlite, type Statement } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    await ensureTablesExist()
    const all = await getDb()
      .select()
      .from(transactions)
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(100)
    return NextResponse.json({ transactions: all })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json()
    const { assetId, symbol, type, date, quantity, price, fee = 0, currency = 'TWD', exchangeRate = 1.0, notes } = body

    if (!symbol || !type || !date || quantity === undefined || price === undefined) {
      return NextResponse.json({ error: 'Missing required transaction fields' }, { status: 400 })
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    const statements: Statement[] = [
      {
        sql: `
          INSERT INTO transactions (
            id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
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
          now,
        ],
      },
    ]

    // If an assetId was provided, update asset holding quantity and cost basis
    if (assetId) {
      const existing = await sqlite.get<any>('SELECT * FROM assets WHERE id = ?', [assetId])
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

        statements.push({
          sql: 'UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?',
          args: [newQty, newCost, now, assetId],
        })
      }
    }

    // 交易紀錄與持倉更新一次寫入（全部成功或全部不生效）
    await sqlite.batch(statements)

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
