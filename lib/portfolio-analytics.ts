/**
 * 全投組量化指標（純計算，不碰資料庫、不打網路）
 *
 * 1. calculateMonthlyRebalance：每月新資金「免賣股」再平衡試算——只用新投入的錢補缺口
 * 2. calculatePortfolioRiskMetrics：等效槓桿倍數、科技/半導體曝險、加密曝險
 * 3. calculateCorrelationMatrix：日線對數報酬的 Pearson 相關係數矩陣
 */
import type { Currency } from './portfolio-types'
import { assetUnitPrice, convertCurrency } from './valuation'

export interface AnalyticsAsset {
  id: string
  symbol: string
  name?: string | null
  targetPercent: number
  quantity: number
  currentPrice?: number | null
  costPerUnit: number
  currency: 'TWD' | 'USD'
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

const normSymbol = (s: string) => (s || '').trim().toUpperCase()

/** 資產在指定幣別下的目前市值（市價 = currentPrice ?? costPerUnit，與全站估值口徑一致） */
function marketValueIn(a: AnalyticsAsset, to: Currency, rate: number): number {
  const qty = Number(a.quantity) || 0
  return convertCurrency(qty * assetUnitPrice(a), a.currency, to, rate)
}

// ---------------------------------------------------------------------------
// 1. 每月新資金免賣股再平衡
// ---------------------------------------------------------------------------
export interface MonthlyRebalanceInput {
  assets: AnalyticsAsset[]
  monthlyInvestmentAmount: number
  displayCurrency: 'TWD' | 'USD'
  exchangeRate: number
}

export interface MonthlyRebalanceSuggestion {
  assetId: string
  symbol: string
  name: string
  targetPercent: number
  currentValue: number
  suggestedBuyAmount: number
  postValue: number
  postWeightPercent: number
}

export interface MonthlyRebalanceResult {
  monthlyInvestmentAmount: number
  displayCurrency: 'TWD' | 'USD'
  totalCurrentValue: number
  projectedTotal: number
  suggestions: MonthlyRebalanceSuggestion[]
}

export function calculateMonthlyRebalance(input: MonthlyRebalanceInput): MonthlyRebalanceResult {
  const { assets, displayCurrency, exchangeRate } = input
  const amount = Number(input.monthlyInvestmentAmount)
  const monthly = Number.isFinite(amount) ? amount : 0

  const rows = assets.map((a) => ({
    asset: a,
    currentValue: marketValueIn(a, displayCurrency, exchangeRate),
    targetPercent: Number(a.targetPercent) || 0,
  }))
  const totalCurrentValue = rows.reduce((s, r) => s + r.currentValue, 0)

  if (!(monthly > 0)) {
    return {
      monthlyInvestmentAmount: monthly,
      displayCurrency,
      totalCurrentValue: round(totalCurrentValue, 2),
      projectedTotal: round(totalCurrentValue, 2),
      suggestions: [],
    }
  }

  const projectedTotal = totalCurrentValue + monthly
  const withDeficit = rows.map((r) => {
    const targetValue = projectedTotal * (r.targetPercent / 100)
    return { ...r, deficit: Math.max(0, targetValue - r.currentValue) }
  })
  const totalDeficit = withDeficit.reduce((s, r) => s + r.deficit, 0)
  const totalTargetPercent = withDeficit.reduce((s, r) => s + Math.max(0, r.targetPercent), 0)

  const suggestions: MonthlyRebalanceSuggestion[] = []
  for (const r of withDeficit) {
    let share = 0
    if (totalDeficit > 0) share = r.deficit / totalDeficit
    else if (totalTargetPercent > 0) share = Math.max(0, r.targetPercent) / totalTargetPercent
    const buy = round(monthly * share, 2)
    if (!(buy > 0)) continue
    const postValue = r.currentValue + buy
    suggestions.push({
      assetId: r.asset.id,
      symbol: r.asset.symbol,
      name: r.asset.name ?? r.asset.symbol,
      targetPercent: r.targetPercent,
      currentValue: round(r.currentValue, 2),
      suggestedBuyAmount: buy,
      postValue: round(postValue, 2),
      postWeightPercent: projectedTotal > 0 ? round((postValue / projectedTotal) * 100, 2) : 0,
    })
  }
  suggestions.sort((a, b) => b.suggestedBuyAmount - a.suggestedBuyAmount)

  return {
    monthlyInvestmentAmount: monthly,
    displayCurrency,
    totalCurrentValue: round(totalCurrentValue, 2),
    projectedTotal: round(projectedTotal, 2),
    suggestions,
  }
}

// ---------------------------------------------------------------------------
// 2. 全投組風險指標
// ---------------------------------------------------------------------------
export const LEVERAGE_MULTIPLIERS: Record<string, number> = {
  SOXL: 3,
  TQQQ: 3,
  UPRO: 3,
  TECL: 3,
  QLD: 2,
  SSO: 2,
  USD: 2, // ProShares Ultra Semiconductors
  '00631L.TW': 2,
  '00675L.TW': 2,
  MSTR: 1.5,
}

export const TECH_SEMI_SYMBOLS = [
  'SOXL', 'SOXX', '2330', '2330.TW', '00935', '00935.TW', '00830', '00830.TW', '00662', '00662.TW', 'QQQ', 'NVDA', 'TSM',
]

export const CRYPTO_SYMBOLS = ['BTC', 'BTC-USD', 'MSTR', 'ETH', 'IBIT']

export interface PortfolioRiskMetrics {
  /** 等效槓桿倍數 = Σ 權重 × 槓桿倍數（小數 2 位） */
  effectiveLeverage: number
  /** 科技 / 半導體曝險（%，小數 1 位） */
  techSemiExposurePercent: number
  /** 加密資產曝險（%，小數 1 位） */
  cryptoExposurePercent: number
}

export function leverageOf(symbol: string): number {
  return LEVERAGE_MULTIPLIERS[normSymbol(symbol)] ?? 1
}

export function calculatePortfolioRiskMetrics(assets: AnalyticsAsset[], exchangeRate: number): PortfolioRiskMetrics {
  const values = assets.map((a) => ({ symbol: normSymbol(a.symbol), usd: marketValueIn(a, 'USD', exchangeRate) }))
  const total = values.reduce((s, v) => s + v.usd, 0)
  if (!(total > 0)) return { effectiveLeverage: 0, techSemiExposurePercent: 0, cryptoExposurePercent: 0 }

  const tech = new Set(TECH_SEMI_SYMBOLS)
  const crypto = new Set(CRYPTO_SYMBOLS)
  let lev = 0
  let techW = 0
  let cryptoW = 0
  for (const v of values) {
    const w = v.usd / total
    lev += w * leverageOf(v.symbol)
    if (tech.has(v.symbol)) techW += w
    if (crypto.has(v.symbol)) cryptoW += w
  }
  return {
    effectiveLeverage: round(lev, 2),
    techSemiExposurePercent: round(techW * 100, 1),
    cryptoExposurePercent: round(cryptoW * 100, 1),
  }
}

// ---------------------------------------------------------------------------
// 3. 相關性矩陣
// ---------------------------------------------------------------------------
export interface CorrelationMatrix {
  symbols: string[]
  window: number
  matrix: Array<Array<number | null>>
}

/** 收盤價序列 → 以日期（YYYY-MM-DD）為 key 的對數日報酬 */
function dailyLogReturns(series: Array<{ t: string; c: number }>): Map<string, number> {
  // 同一天多筆時以最後一筆為準，並依日期排序
  const byDate = new Map<string, number>()
  for (const p of series || []) {
    if (!p || typeof p.t !== 'string') continue
    const c = Number(p.c)
    if (!Number.isFinite(c) || c <= 0) continue
    byDate.set(p.t.slice(0, 10), c)
  }
  const dates = [...byDate.keys()].sort()
  const out = new Map<string, number>()
  for (let i = 1; i < dates.length; i++) {
    const prev = byDate.get(dates[i - 1])!
    const cur = byDate.get(dates[i])!
    out.set(dates[i], Math.log(cur / prev))
  }
  return out
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n === 0) return null
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  // 標準差為 0（含浮點誤差造成的極小值）→ 無法計算
  if (!(sxx > 1e-20) || !(syy > 1e-20)) return null
  const r = sxy / Math.sqrt(sxx * syy)
  return round(Math.max(-1, Math.min(1, r)), 2)
}

export function calculateCorrelationMatrix(
  seriesBySymbol: Record<string, Array<{ t: string; c: number }>>,
  window = 60
): CorrelationMatrix {
  const symbols = Object.keys(seriesBySymbol)
  const returns = symbols.map((s) => dailyLogReturns(seriesBySymbol[s]))
  const minCount = Math.min(20, window)

  const matrix = symbols.map((symA, i) =>
    symbols.map((symB, j) => {
      if (symA === symB || i === j) return 1
      const ra = returns[i]
      const rb = returns[j]
      const common = [...ra.keys()].filter((d) => rb.has(d)).sort().slice(-window)
      if (common.length < minCount) return null
      return pearson(
        common.map((d) => ra.get(d)!),
        common.map((d) => rb.get(d)!)
      )
    })
  )
  return { symbols, window, matrix }
}
