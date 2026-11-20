import { describe, it, expect } from 'vitest'
import {
  calculateMonthlyRebalance,
  calculatePortfolioRiskMetrics,
  calculateCorrelationMatrix,
  type AnalyticsAsset,
} from '../lib/portfolio-analytics'

const asset = (p: Partial<AnalyticsAsset> & { id: string; symbol: string }): AnalyticsAsset => ({
  targetPercent: 0,
  quantity: 0,
  currentPrice: null,
  costPerUnit: 0,
  currency: 'USD',
  ...p,
})

describe('calculateMonthlyRebalance：每月新資金免賣股再平衡', () => {
  it('有缺口：依缺口比例分配，金額降冪排序', () => {
    // A 現值 6000、B 現值 2000、C 現值 2000；投入 2000 → projectedTotal 12000
    // 目標 A 50% = 6000（缺口 0）、B 30% = 3600（缺口 1600）、C 20% = 2400（缺口 400）
    const r = calculateMonthlyRebalance({
      assets: [
        asset({ id: 'a', symbol: 'A', targetPercent: 50, quantity: 60, currentPrice: 100 }),
        asset({ id: 'b', symbol: 'B', targetPercent: 30, quantity: 20, currentPrice: 100 }),
        asset({ id: 'c', symbol: 'C', name: '丙', targetPercent: 20, quantity: 20, costPerUnit: 100 }), // 無報價用成本價
      ],
      monthlyInvestmentAmount: 2000,
      displayCurrency: 'USD',
      exchangeRate: 30,
    })
    expect(r.totalCurrentValue).toBe(10000)
    expect(r.projectedTotal).toBe(12000)
    expect(r.suggestions.map((s) => s.symbol)).toEqual(['B', 'C'])
    expect(r.suggestions[0].suggestedBuyAmount).toBe(1600)
    expect(r.suggestions[0].postValue).toBe(3600)
    expect(r.suggestions[0].postWeightPercent).toBe(30)
    expect(r.suggestions[0].name).toBe('B')
    expect(r.suggestions[1]).toMatchObject({ assetId: 'c', name: '丙', suggestedBuyAmount: 400, currentValue: 2000, postValue: 2400 })
  })

  it('有缺口且需換匯：TWD 資產換算成顯示幣別、缺口超過投入金額時按比例縮小', () => {
    const r = calculateMonthlyRebalance({
      assets: [
        asset({ id: 'tw', symbol: '2330.TW', targetPercent: 50, quantity: 0, currentPrice: 1000, currency: 'TWD' }),
        asset({ id: 'us', symbol: 'QQQ', targetPercent: 50, quantity: 30, currentPrice: 100, currency: 'USD' }),
      ],
      monthlyInvestmentAmount: 30000, // TWD
      displayCurrency: 'TWD',
      exchangeRate: 30,
    })
    // QQQ = 3000 USD = 90000 TWD；projected = 120000；目標各 60000 → 2330 缺口 60000、QQQ 缺口 0
    expect(r.totalCurrentValue).toBe(90000)
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0]).toMatchObject({ assetId: 'tw', suggestedBuyAmount: 30000, postWeightPercent: 25 })
  })

  it('無缺口：依目標比例分配', () => {
    // 現值完全超過目標時缺口皆為 0 的情境：目標比例總和 < 100，所有資產都已超標
    const r = calculateMonthlyRebalance({
      assets: [
        asset({ id: 'a', symbol: 'A', targetPercent: 30, quantity: 50, currentPrice: 100 }),
        asset({ id: 'b', symbol: 'B', targetPercent: 10, quantity: 50, currentPrice: 100 }),
      ],
      monthlyInvestmentAmount: 1000,
      displayCurrency: 'USD',
      exchangeRate: 30,
    })
    // projected 11000 → 目標 3300 / 1100，現值 5000 / 5000 → 缺口 0
    expect(r.suggestions.map((s) => [s.symbol, s.suggestedBuyAmount])).toEqual([
      ['A', 750],
      ['B', 250],
    ])
  })

  it('投入金額為 0 或負數：回傳空建議', () => {
    const base = {
      assets: [asset({ id: 'a', symbol: 'A', targetPercent: 100, quantity: 10, currentPrice: 10 })],
      displayCurrency: 'USD' as const,
      exchangeRate: 30,
    }
    const zero = calculateMonthlyRebalance({ ...base, monthlyInvestmentAmount: 0 })
    expect(zero.suggestions).toEqual([])
    expect(zero.totalCurrentValue).toBe(100)
    expect(zero.projectedTotal).toBe(100)
    expect(calculateMonthlyRebalance({ ...base, monthlyInvestmentAmount: -500 }).suggestions).toEqual([])
  })

  it('建議金額保留 2 位小數', () => {
    const r = calculateMonthlyRebalance({
      assets: [
        asset({ id: 'a', symbol: 'A', targetPercent: 100 / 3, quantity: 0, currentPrice: 1 }),
        asset({ id: 'b', symbol: 'B', targetPercent: 100 / 3, quantity: 0, currentPrice: 1 }),
        asset({ id: 'c', symbol: 'C', targetPercent: 100 / 3, quantity: 0, currentPrice: 1 }),
      ],
      monthlyInvestmentAmount: 100,
      displayCurrency: 'USD',
      exchangeRate: 30,
    })
    for (const s of r.suggestions) expect(s.suggestedBuyAmount).toBe(33.33)
  })
})

describe('calculatePortfolioRiskMetrics：等效槓桿與曝險', () => {
  it('依美元權重計算等效槓桿、科技/半導體與加密曝險', () => {
    const m = calculatePortfolioRiskMetrics(
      [
        asset({ id: '1', symbol: 'SOXL', quantity: 10, currentPrice: 100 }), // 1000 USD，3x，科技
        asset({ id: '2', symbol: 'mstr', quantity: 10, currentPrice: 100 }), // 1000 USD，1.5x，加密（小寫也認得）
        asset({ id: '3', symbol: '2330.TW', quantity: 30, currentPrice: 1000, currency: 'TWD' }), // 30000 TWD = 1000 USD，1x，科技
        asset({ id: '4', symbol: 'SOXL_CASH_BUFFER', quantity: 1000, costPerUnit: 1 }), // 1000 USD，1x
      ],
      30
    )
    // 槓桿 = 0.25×3 + 0.25×1.5 + 0.25×1 + 0.25×1 = 1.625 → 1.63
    expect(m.effectiveLeverage).toBe(1.63)
    expect(m.techSemiExposurePercent).toBe(50)
    expect(m.cryptoExposurePercent).toBe(25)
  })

  it('2x 標的與小數位數', () => {
    const m = calculatePortfolioRiskMetrics(
      [
        asset({ id: '1', symbol: '00631L.TW', quantity: 1, currentPrice: 300, currency: 'TWD' }), // 10 USD，2x
        asset({ id: '2', symbol: 'BTC', quantity: 1, currentPrice: 20 }), // 20 USD，加密
      ],
      30
    )
    expect(m.effectiveLeverage).toBe(1.33) // (10×2 + 20×1) / 30
    expect(m.techSemiExposurePercent).toBe(0)
    expect(m.cryptoExposurePercent).toBe(66.7)
  })

  it('總市值為 0 時全部回 0', () => {
    expect(calculatePortfolioRiskMetrics([asset({ id: '1', symbol: 'SOXL' })], 30)).toEqual({
      effectiveLeverage: 0,
      techSemiExposurePercent: 0,
      cryptoExposurePercent: 0,
    })
    expect(calculatePortfolioRiskMetrics([], 30).effectiveLeverage).toBe(0)
  })
})

describe('calculateCorrelationMatrix：相關性矩陣', () => {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString()
  // 用確定性的「隨機」報酬，避免常數報酬造成標準差 0
  const rets = Array.from({ length: 80 }, (_, i) => Math.sin(i * 1.7) * 0.02 + Math.cos(i * 0.31) * 0.01)
  const build = (f: (r: number) => number, n = rets.length) => {
    let c = 100
    const out = [{ t: day(0), c }]
    for (let i = 0; i < n; i++) {
      c = c * Math.exp(f(rets[i]))
      out.push({ t: day(i + 1), c })
    }
    return out
  }

  it('正相關、負相關、對角線為 1', () => {
    const r = calculateCorrelationMatrix(
      {
        A: build((x) => x),
        B: build((x) => 2 * x), // 完全正相關
        C: build((x) => -x), // 完全負相關
      },
      60
    )
    expect(r.symbols).toEqual(['A', 'B', 'C'])
    expect(r.window).toBe(60)
    expect(r.matrix[0][0]).toBe(1)
    expect(r.matrix[0][1]).toBe(1)
    expect(r.matrix[1][0]).toBe(1)
    expect(r.matrix[0][2]).toBe(-1)
    expect(r.matrix[2][1]).toBe(-1)
  })

  it('只用共同日期，且同一天多筆時取最後一筆', () => {
    const a = build((x) => x)
    // B 只有後半段日期，且日期帶不同時間（slice(0,10) 對齊）
    const b = build((x) => x).slice(40).map((p) => ({ t: p.t.slice(0, 10) + 'T13:30:00.000Z', c: p.c * 3 }))
    const r = calculateCorrelationMatrix({ A: a, B: b }, 60)
    expect(r.matrix[0][1]).toBe(1)
  })

  it('資料不足或標準差為 0 回 null', () => {
    const short = build((x) => x, 10) // 只有 10 筆報酬 < 20
    const flat = Array.from({ length: 50 }, (_, i) => ({ t: day(i), c: 100 }))
    const r = calculateCorrelationMatrix({ A: build((x) => x), S: short, F: flat, E: [] }, 60)
    expect(r.matrix[0][1]).toBeNull()
    expect(r.matrix[0][2]).toBeNull()
    expect(r.matrix[0][3]).toBeNull()
    expect(r.matrix[3][3]).toBe(1)
  })

  it('window 小於 20 時門檻改為 window', () => {
    const r = calculateCorrelationMatrix({ A: build((x) => x, 10), B: build((x) => -x, 10) }, 5)
    expect(r.matrix[0][1]).toBe(-1)
  })
})
