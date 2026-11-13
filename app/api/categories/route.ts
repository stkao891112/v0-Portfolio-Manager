import { NextResponse } from 'next/server'
import { getDb, sqlite } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { asc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    await ensureTablesExist()
    const all = await getDb().select().from(categories).orderBy(asc(categories.sortOrder))
    return NextResponse.json({ categories: all })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json()
    const { name, color, targetPercent = 0 } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    const maxOrder = await sqlite.get<{ maxOrder: number | null }>(
      'SELECT MAX(sort_order) as maxOrder FROM categories'
    )
    const sortOrder = Number(maxOrder?.maxOrder ?? 0) + 1

    await sqlite.run(
      `
      INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [id, name, color || 'oklch(0.72 0.19 180)', sortOrder, targetPercent, now, now]
    )

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json()
    const { id, name, color, targetPercent, sortOrder } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const existing = await sqlite.get<any>('SELECT * FROM categories WHERE id = ?', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    await sqlite.run(
      `
      UPDATE categories
      SET name = ?, color = ?, target_percent = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `,
      [
        name ?? existing.name,
        color ?? existing.color,
        targetPercent ?? existing.target_percent,
        sortOrder ?? existing.sort_order,
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
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // 一併刪除類別底下的資產；交易紀錄保留但解除關聯（等同原本外鍵的 CASCADE / SET NULL）
    await sqlite.batch([
      {
        sql: 'UPDATE transactions SET asset_id = NULL WHERE asset_id IN (SELECT id FROM assets WHERE category_id = ?)',
        args: [id],
      },
      { sql: 'DELETE FROM assets WHERE category_id = ?', args: [id] },
      { sql: 'DELETE FROM categories WHERE id = ?', args: [id] },
    ])
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
