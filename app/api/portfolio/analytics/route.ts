/**
 * GET /api/portfolio/analytics
 * 全投組量化指標：每月新資金免賣股再平衡試算、風險曝險、60/90 日相關性矩陣
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { assets as assetsTable } from '@/lib/db/schema'
import { ensureTablesExist } from '@/lib/db/init'
import { loadPortfolioSettings } from '@/lib/strategies/config-loader'
import { getYahooCloses, type ClosePoint } from '@/lib/market-data/external-sources'
import { convertCurrency, isCashLikeSymbol } from '@/lib/valuation'
import {
  calculateCorrelationMatrix,
  calculateMonthlyRebalance,
  calculatePortfolioRiskMetrics,
  type AnalyticsAsset,
} from '@/lib/portfolio-analytics'

export const dynamic = 'force-dynamic'

const MAX_CORRELATION_SYMBOLS = 8

/** 投組代號 → Yahoo 代號（BTC → BTC-USD；純數字台股代號補 .TW） */
function toYahooSymbol(symbol: string): string {
  const s = (symbol || '').trim().toUpperCase()
  if (s === 'BTC') return 'BTC-USD'
  if (/^\d{4,6}[A-Z]?$/.test(s)) return `${s}.TW`
  return s
}

export async function GET() {
  try {
    await ensureTablesExist()
    const settings = await loadPortfolioSettings()
    const rows = await getDb().select().from(assetsTable)

    const assets: AnalyticsAsset[] = rows.map((a) => ({
      id: a.id,
      symbol: a.symbol,
      name: a.name ?? undefined,
      targetPercent: Number(a.targetPercent) || 0,
      quantity: Number(a.quantity) || 0,
      currentPrice: a.currentPrice,
      costPerUnit: Number(a.costPerUnit) || 0,
      currency: a.currency === 'USD' ? 'USD' : 'TWD',
    }))

    // 每月投入金額在設定頁以新台幣輸入，換算成顯示幣別後再試算
    const monthlyInDisplay = convertCurrency(
      settings.monthlyInvestmentAmount,
      'TWD',
      settings.displayCurrency,
      settings.exchangeRate
    )
    const monthlyRebalance = calculateMonthlyRebalance({
      assets,
      monthlyInvestmentAmount: monthlyInDisplay,
      displayCurrency: settings.displayCurrency,
      exchangeRate: settings.exchangeRate,
    })
    const riskMetrics = calculatePortfolioRiskMetrics(assets, settings.exchangeRate)

    // 相關性：非現金類標的，依美元市值由大到小取前 8 檔（同代號只算一次）
    const valueUsd = (a: AnalyticsAsset) =>
      convertCurrency(
        a.quantity * (a.currentPrice != null && a.currentPrice > 0 ? a.currentPrice : a.costPerUnit),
        a.currency,
        'USD',
        settings.exchangeRate
      )
    const symbols: string[] = []
    for (const a of [...assets].sort((x, y) => valueUsd(y) - valueUsd(x))) {
      const sym = (a.symbol || '').trim().toUpperCase()
      if (!sym || isCashLikeSymbol(sym) || symbols.includes(sym)) continue
      symbols.push(sym)
      if (symbols.length >= MAX_CORRELATION_SYMBOLS) break
    }

    const fetched = await Promise.all(
      symbols.map((sym) =>
        getYahooCloses(toYahooSymbol(sym), '6mo', '1d', 3600).catch(() => ({ value: [] as ClosePoint[] }))
      )
    )
    const seriesBySymbol: Record<string, ClosePoint[]> = {}
    symbols.forEach((sym, i) => {
      seriesBySymbol[sym] = fetched[i]?.value ?? []
    })

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      monthlyRebalance,
      riskMetrics,
      correlation60d: calculateCorrelationMatrix(seriesBySymbol, 60),
      correlation90d: calculateCorrelationMatrix(seriesBySymbol, 90),
    })
  } catch (error: any) {
    console.error('Failed to compute portfolio analytics:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
