import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { runSoxlBacktest, BACKTEST_SCENARIOS } from '@/lib/strategies/backtest'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const scenarioId = searchParams.get('scenarioId') || 'bear_2022'

    const scenario = BACKTEST_SCENARIOS.find((s) => s.id === scenarioId) || BACKTEST_SCENARIOS[0]

    // Fetch historical data for SOXX and SOXL in that date range
    const startDate = new Date(scenario.startDate)
    const endDate = new Date(scenario.endDate)

    const [soxxBars, soxlBars] = await Promise.all([
      marketService['provider'].getHistoricalPrices('SOXX', startDate, endDate, '1wk'),
      marketService['provider'].getHistoricalPrices('SOXL', startDate, endDate, '1wk'),
    ])

    const result = runSoxlBacktest({
      soxxBars,
      soxlBars,
      scenarioName: scenario.name,
    })

    return NextResponse.json({
      scenarios: BACKTEST_SCENARIOS,
      currentScenario: scenario,
      result,
    })
  } catch (error: any) {
    console.error('Backtest API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
