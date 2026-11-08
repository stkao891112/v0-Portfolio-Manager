import { NextResponse } from 'next/server'
import { db, sqlite } from '@/lib/db/client'
import { categories, assets, portfolioSettings } from '@/lib/db/schema'
import { ensureTablesExist, seedDefaultPortfolioIfEmpty } from '@/lib/db/init'
import { eq, asc } from 'drizzle-orm'

export async function GET() {
  try {
    ensureTablesExist()
    seedDefaultPortfolioIfEmpty()

    const settingsList = await db.select().from(portfolioSettings).limit(1)
    const settings = settingsList[0] || {
      displayCurrency: 'TWD',
      exchangeRate: 32.5,
      monthlyInvestmentAmount: 20000,
      emergencyFundAmount: 0,
      soxlReserveTargetPercent: 10.0,
      soxlMaxPositionPercent: 5.0,
    }

    const allCategories = await db.select().from(categories).orderBy(asc(categories.sortOrder))
    const allAssets = await db.select().from(assets)

    const categoriesWithAssets = allCategories.map((cat) => ({
      ...cat,
      assets: allAssets.filter((a) => a.categoryId === cat.id),
    }))

    // Calculate totals
    const exchangeRate = settings.exchangeRate || 32.5
    const displayCurrency = settings.displayCurrency || 'TWD'

    let totalPortfolioCost = 0
    let totalPortfolioValue = 0

    for (const cat of categoriesWithAssets) {
      for (const a of cat.assets) {
        const costBasis = a.quantity * a.costPerUnit
        const currentPrice = a.currentPrice || a.costPerUnit
        const marketValue = a.quantity * currentPrice

        // Convert to display currency
        const costConverted =
          a.currency === displayCurrency
            ? costBasis
            : a.currency === 'USD' && displayCurrency === 'TWD'
            ? costBasis * exchangeRate
            : costBasis / exchangeRate

        const valueConverted =
          a.currency === displayCurrency
            ? marketValue
            : a.currency === 'USD' && displayCurrency === 'TWD'
            ? marketValue * exchangeRate
            : marketValue / exchangeRate

        totalPortfolioCost += costConverted
        totalPortfolioValue += valueConverted
      }
    }

    const unrealizedPnl = totalPortfolioValue - totalPortfolioCost
    const unrealizedPnlPercent = totalPortfolioCost > 0 ? (unrealizedPnl / totalPortfolioCost) * 100 : 0

    return NextResponse.json({
      settings,
      categories: categoriesWithAssets,
      summary: {
        totalPortfolioCost,
        totalPortfolioValue,
        unrealizedPnl,
        unrealizedPnlPercent,
        categoriesCount: allCategories.length,
        assetsCount: allAssets.length,
      },
    })
  } catch (error: any) {
    console.error('Failed to get portfolio:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const now = new Date().toISOString()

    sqlite.prepare(`
      INSERT OR REPLACE INTO portfolio_settings (
        id, display_currency, exchange_rate, monthly_investment_amount,
        emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.displayCurrency || 'TWD',
      body.exchangeRate ?? 32.5,
      body.monthlyInvestmentAmount ?? 20000,
      body.emergencyFundAmount ?? 0,
      body.soxlReserveTargetPercent ?? 10.0,
      body.soxlMaxPositionPercent ?? 5.0,
      now
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to update portfolio settings:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
