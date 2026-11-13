import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'

export async function GET(request: Request) {
  try {
    ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')

    if (!symbolsParam) {
      return NextResponse.json({ error: 'symbols query parameter is required' }, { status: 400 })
    }

    const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    const quotes = await marketService.getQuotes(symbols)

    // Save to SQLite cache and update asset prices
    const now = new Date().toISOString()
    const insertPrice = sqlite.prepare(`
      INSERT OR REPLACE INTO market_prices (id, symbol, price, change_24h, volume, is_stale, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const updateAssetPrice = sqlite.prepare(`
      UPDATE assets SET current_price = ?, price_updated_at = ? WHERE symbol = ?
    `)

    for (const [sym, q] of Object.entries(quotes)) {
      if (q && q.price > 0) {
        insertPrice.run(sym, sym, q.price, q.changePercent, q.volume || 0, q.isStale ? 1 : 0, q.timestamp)
        updateAssetPrice.run(q.price, q.timestamp, sym)
      }
    }

    return NextResponse.json({ quotes })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
