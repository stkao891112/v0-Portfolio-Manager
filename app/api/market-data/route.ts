import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')
    const symbolParam = searchParams.get('symbol')
    const history = searchParams.get('history')

    // Case 1: Weekly history request
    if (history && symbolParam) {
      const bars = await marketService.getWeeklyBars(symbolParam)
      return NextResponse.json({ symbol: symbolParam, bars })
    }

    // Case 2: Batch quotes request
    if (symbolsParam) {
      const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
      const quotes = await marketService.getQuotes(symbols)
      return NextResponse.json({ quotes })
    }

    // Case 3: Single quote
    if (symbolParam) {
      const quote = await marketService.getQuote(symbolParam)
      return NextResponse.json({ quote })
    }

    // Default: fetch core watch list
    const defaultWatchList = ['SOXX', 'SOXL', 'QQQ', 'MSTR', 'BTC', '2330.TW', '00662.TW', '00935.TW']
    const quotes = await marketService.getQuotes(defaultWatchList)
    return NextResponse.json({ quotes })
  } catch (error: any) {
    console.error('Market data API error:', error)
    return NextResponse.json({ error: error.message || 'Market data unavailable' }, { status: 500 })
  }
}
