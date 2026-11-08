import { NextResponse } from 'next/server'
import { db, sqlite } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { eq, asc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    ensureTablesExist()
    const all = await db.select().from(categories).orderBy(asc(categories.sortOrder))
    return NextResponse.json({ categories: all })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { name, color, targetPercent = 0 } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    const maxOrder = sqlite.prepare('SELECT MAX(sort_order) as maxOrder FROM categories').get() as { maxOrder: number | null }
    const sortOrder = (maxOrder?.maxOrder ?? 0) + 1

    sqlite.prepare(`
      INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, color || 'oklch(0.72 0.19 180)', sortOrder, targetPercent, now, now)

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { id, name, color, targetPercent, sortOrder } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const existing = sqlite.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    sqlite.prepare(`
      UPDATE categories
      SET name = ?, color = ?, target_percent = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name ?? existing.name,
      color ?? existing.color,
      targetPercent ?? existing.target_percent,
      sortOrder ?? existing.sort_order,
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
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    sqlite.prepare('DELETE FROM categories WHERE id = ?').run(id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
