import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { ensureTablesExist } from '@/lib/db/init'
import { sqlite, type Statement } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

/**
 * 批次報價：GET /api/market-data/quotes?symbols=2330.TW,00662.TW,SOXL
 *
 * market_prices 快取由 marketService.getQuote 統一寫入（change_24h 一律存漲跌幅 %；
 * 舊版這裡又用 INSERT OR REPLACE 重寫一次，造成同一欄位金額與百分比混寫）。
 */
export async function GET(request: Request) {
  try {
    await ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')

    if (!symbolsParam) {
      return NextResponse.json({ error: 'symbols query parameter is required' }, { status: 400 })
    }

    const symbols = Array.from(
      new Set(symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
    ).slice(0, 50)
    const { quotes, errors } = await marketService.getQuotesDetailed(symbols)

    // 命中 60 秒報價快取時 getQuote 不會寫 assets；這裡統一把報價同步到持倉
    // （例如資產是在快取之後才新增的）。過期報價只補空值，不覆蓋較新的價格。
    const statements: Statement[] = []
    for (const [sym, q] of Object.entries(quotes)) {
      if (!(q?.price > 0)) continue
      statements.push({
        sql: q.isStale
          ? 'UPDATE assets SET current_price = ?, price_updated_at = ? WHERE UPPER(symbol) = ? AND current_price IS NULL'
          : 'UPDATE assets SET current_price = ?, price_updated_at = ? WHERE UPPER(symbol) = ?',
        args: [q.price, q.timestamp, sym],
      })
    }
    await sqlite.batch(statements)

    return NextResponse.json({ quotes, errors, fetchedAt: new Date().toISOString() })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
