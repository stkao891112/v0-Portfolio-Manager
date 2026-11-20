/**
 * 共用估值口徑（前端各頁、策略 API、投組 API 都用這裡）
 *
 * 市價 = currentPrice（有報價時）否則退回 costPerUnit（成本價）。
 * 現值 = 數量 × 市價；成本 = 數量 × 成本價；未實現損益 = 現值 − 成本。
 */
import type { Currency } from './portfolio-types'

export interface ValuableAsset {
  symbol: string
  quantity: number
  costPerUnit: number
  currency?: Currency | string | null
  currentPrice?: number | null
  priceUpdatedAt?: string | null
}

/** 現金、預備金這類沒有市場報價的標的（不打報價 API） */
export function isCashLikeSymbol(symbol: string): boolean {
  const s = (symbol || '').toUpperCase()
  return s.includes('CASH') || s.includes('BUFFER')
}

/** 市價：有效報價優先，沒有就用成本價 */
export function assetUnitPrice(a: Pick<ValuableAsset, 'currentPrice' | 'costPerUnit'>): number {
  const p = a.currentPrice
  return p != null && Number.isFinite(p) && p > 0 ? p : Number(a.costPerUnit) || 0
}

/** 這個標的目前是否用真實報價估值（false = 用成本價代替） */
export function hasMarketPrice(a: Pick<ValuableAsset, 'currentPrice'>): boolean {
  return a.currentPrice != null && Number.isFinite(a.currentPrice) && a.currentPrice > 0
}

export function assetMarketValue(a: ValuableAsset): number {
  return (Number(a.quantity) || 0) * assetUnitPrice(a)
}

export function assetCostValue(a: ValuableAsset): number {
  return (Number(a.quantity) || 0) * (Number(a.costPerUnit) || 0)
}

/** 幣別換算：rate = 1 USD 可換多少 TWD */
export function convertCurrency(value: number, from: string | null | undefined, to: Currency, rate: number): number {
  const src = (from || 'USD') as Currency
  if (src === to) return value
  if (!(rate > 0)) return value
  if (src === 'USD' && to === 'TWD') return value * rate
  if (src === 'TWD' && to === 'USD') return value / rate
  return value
}

export interface AssetValuation {
  marketValue: number // 顯示幣別
  costValue: number // 顯示幣別
  unrealizedPnl: number
  unrealizedPnlPercent: number
  unitPrice: number // 原幣
  usesMarketPrice: boolean
}

export function valueAsset(a: ValuableAsset, displayCurrency: Currency, rate: number): AssetValuation {
  const marketValue = convertCurrency(assetMarketValue(a), a.currency, displayCurrency, rate)
  const costValue = convertCurrency(assetCostValue(a), a.currency, displayCurrency, rate)
  const unrealizedPnl = marketValue - costValue
  return {
    marketValue,
    costValue,
    unrealizedPnl,
    unrealizedPnlPercent: costValue > 0 ? (unrealizedPnl / costValue) * 100 : 0,
    unitPrice: assetUnitPrice(a),
    usesMarketPrice: hasMarketPrice(a),
  }
}

export interface PortfolioValuation {
  totalValue: number
  totalCost: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  /** 各分類現值（顯示幣別），key = 分類 id */
  categoryValues: Record<string, number>
  /** 最新一筆報價更新時間（ISO），沒有任何報價時為 null */
  latestPriceUpdatedAt: string | null
  /** 有持倉卻沒有市價（用成本價代替）的標的 */
  assetsWithoutPrice: string[]
}

export function valuePortfolio(
  categories: { id: string; assets: ValuableAsset[] }[],
  displayCurrency: Currency,
  rate: number
): PortfolioValuation {
  let totalValue = 0
  let totalCost = 0
  let latest: string | null = null
  const categoryValues: Record<string, number> = {}
  const assetsWithoutPrice: string[] = []

  for (const cat of categories) {
    let catValue = 0
    for (const a of cat.assets) {
      const v = valueAsset(a, displayCurrency, rate)
      catValue += v.marketValue
      totalCost += v.costValue
      if (a.priceUpdatedAt && (!latest || a.priceUpdatedAt > latest)) latest = a.priceUpdatedAt
      if (!v.usesMarketPrice && (Number(a.quantity) || 0) > 0 && !isCashLikeSymbol(a.symbol)) {
        assetsWithoutPrice.push(a.symbol)
      }
    }
    categoryValues[cat.id] = catValue
    totalValue += catValue
  }

  const unrealizedPnl = totalValue - totalCost
  return {
    totalValue,
    totalCost,
    unrealizedPnl,
    unrealizedPnlPercent: totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0,
    categoryValues,
    latestPriceUpdatedAt: latest,
    assetsWithoutPrice,
  }
}
