export type Currency = 'USD' | 'TWD'

export interface Asset {
  id: string
  symbol: string
  name?: string
  targetPercent: number
  quantity: number
  costPerUnit: number
  currency: Currency
  currentPrice?: number
  priceUpdatedAt?: string
}

export interface Category {
  id: string
  name: string
  color: string
  assets: Asset[]
}

export interface PortfolioState {
  categories: Category[]
}

export const CATEGORY_COLORS = [
  'oklch(0.72 0.19 180)', // Cyan
  'oklch(0.65 0.18 280)', // Purple
  'oklch(0.70 0.16 50)',  // Orange
  'oklch(0.75 0.15 140)', // Green
  'oklch(0.68 0.17 330)', // Pink
  'oklch(0.70 0.18 220)', // Blue
]

export function getNextColor(usedColors: string[]): string {
  for (const color of CATEGORY_COLORS) {
    if (!usedColors.includes(color)) {
      return color
    }
  }
  return CATEGORY_COLORS[usedColors.length % CATEGORY_COLORS.length]
}
