import { NextResponse } from 'next/server'
import { getDb, sqlite } from '@/lib/db/client'
import { categories, assets } from '@/lib/db/schema'
import { ensureTablesExist, seedDefaultPortfolioIfEmpty } from '@/lib/db/init'
import { loadPortfolioSettings } from '@/lib/strategies/config-loader'
import { mergePortfolioSettings, SettingsValidationError } from '@/lib/portfolio-settings'
import { valuePortfolio } from '@/lib/valuation'
import { asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureTablesExist()
    await seedDefaultPortfolioIfEmpty()
    const db = getDb()

    const settings = await loadPortfolioSettings()
    const allCategories = await db.select().from(categories).orderBy(asc(categories.sortOrder))
    const allAssets = await db.select().from(assets)

    const categoriesWithAssets = allCategories.map((cat) => ({
      ...cat,
      assets: allAssets.filter((a) => a.categoryId === cat.id),
    }))

    // 與前端相同的估值口徑：市價 = currentPrice ?? costPerUnit
    const v = valuePortfolio(categoriesWithAssets, settings.displayCurrency, settings.exchangeRate)

    return NextResponse.json({
      settings,
      categories: categoriesWithAssets,
      summary: {
        totalPortfolioCost: v.totalCost,
        totalPortfolioValue: v.totalValue,
        unrealizedPnl: v.unrealizedPnl,
        unrealizedPnlPercent: v.unrealizedPnlPercent,
        latestPriceUpdatedAt: v.latestPriceUpdatedAt,
        categoriesCount: allCategories.length,
        assetsCount: allAssets.length,
      },
    })
  } catch (error: any) {
    console.error('Failed to get portfolio:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

/** 局部更新設定：只改有送來的欄位，其餘保留資料庫原值 */
export async function PUT(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '請求內容格式錯誤' }, { status: 400 })
    }

    const existing = await loadPortfolioSettings()
    const merged = mergePortfolioSettings(existing, body)
    const now = new Date().toISOString()

    await sqlite.run(
      `
      INSERT INTO portfolio_settings (
        id, display_currency, exchange_rate, monthly_investment_amount,
        emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent,
        mstr_net_debt_usd, mstr_preferred_stock_usd, mstr_diluted_shares_override, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_currency = excluded.display_currency,
        exchange_rate = excluded.exchange_rate,
        monthly_investment_amount = excluded.monthly_investment_amount,
        emergency_fund_amount = excluded.emergency_fund_amount,
        soxl_reserve_target_percent = excluded.soxl_reserve_target_percent,
        soxl_max_position_percent = excluded.soxl_max_position_percent,
        mstr_net_debt_usd = excluded.mstr_net_debt_usd,
        mstr_preferred_stock_usd = excluded.mstr_preferred_stock_usd,
        mstr_diluted_shares_override = excluded.mstr_diluted_shares_override,
        updated_at = excluded.updated_at
    `,
      [
        merged.displayCurrency,
        merged.exchangeRate,
        merged.monthlyInvestmentAmount,
        merged.emergencyFundAmount,
        merged.soxlReserveTargetPercent,
        merged.soxlMaxPositionPercent,
        merged.mstrNetDebtUsd ?? 0,
        merged.mstrPreferredStockUsd ?? 0,
        merged.mstrDilutedSharesOverride ?? null,
        now,
      ]
    )

    return NextResponse.json({ success: true, settings: merged })
  } catch (error: any) {
    if (error instanceof SettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Failed to update portfolio settings:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
