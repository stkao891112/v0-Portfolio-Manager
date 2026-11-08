import { NextResponse } from 'next/server'
import { defaultMarketProvider } from '@/lib/market-data/yahoo-provider'
import { ensureTablesExist } from '@/lib/db/init'

export async function GET(request: Request) {
  try {
    ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol') || 'SOXX'
    const weeks = parseInt(searchParams.get('weeks') || '104', 10)

    const bars = await defaultMarketProvider.getWeeklyBars(symbol, weeks)

    return NextResponse.json({
      symbol,
      count: bars.length,
      bars,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
