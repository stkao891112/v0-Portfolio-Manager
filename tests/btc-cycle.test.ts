import { describe, it, expect } from 'vitest'
import { linearScore, interpolate, scoreCycle, decideAllocation, BTC_CYCLE_CONFIG, monthsSinceLastHalving } from '../lib/strategies/btc-cycle'

describe('btc-cycle 基本計算', () => {
  it('linearScore 夾在 0～100', () => {
    expect(linearScore(0.5, 0.8, 3.7)).toBe(0)
    expect(linearScore(5, 0.8, 3.7)).toBe(100)
    expect(linearScore(2.25, 0.8, 3.7)).toBeCloseTo(50)
  })
  it('interpolate 折線插值', () => {
    expect(interpolate(BTC_CYCLE_CONFIG.mstrShareCurve, 0)).toBe(75)
    expect(interpolate(BTC_CYCLE_CONFIG.mstrShareCurve, 50)).toBe(50)
    expect(interpolate(BTC_CYCLE_CONFIG.mstrShareCurve, 95)).toBe(0)
  })
  it('減半月數', () => {
    expect(monthsSinceLastHalving(new Date('2025-04-20'))).toBeCloseTo(12, 0)
  })
})

describe('scoreCycle', () => {
  const flat = (n: number, v: number) => Array(n).fill(v)
  it('底部情境分數低', () => {
    const r = scoreCycle({
      now: new Date('2026-11-20'),
      btcPrice: 50000,
      btcWeeklyCloses: flat(210, 50000),
      btcDailyCloses: flat(210, 70000),
      mvrv: 0.9,
      fearGreed: 10,
      stale: { price: false, mvrv: false, fearGreed: false },
    })
    expect(r.score).toBeLessThan(25)
    expect(r.phase).toBe('ACCUMULATE')
    expect(r.reliable).toBe(true)
  })
  it('缺資料時權重重新分配且標示不可靠', () => {
    const r = scoreCycle({
      now: new Date('2026-11-20'),
      btcPrice: 50000,
      btcWeeklyCloses: [],
      btcDailyCloses: [],
      mvrv: null,
      fearGreed: 50,
      stale: { price: true, mvrv: true, fearGreed: false },
    })
    expect(r.reliable).toBe(false)
    expect(r.score).toBeGreaterThanOrEqual(0)
  })
})

describe('decideAllocation', () => {
  const base = { reliable: true, anyStale: false, totalPortfolioUsd: 100000 }
  it('底部且 MSTR 偏少 → 加碼 MSTR', () => {
    const r = decideAllocation({ ...base, cycleScore: 10, mnav: 1.2, btcValueUsd: 20000, mstrValueUsd: 5000 })
    expect(r.targetMstrShare).toBeGreaterThan(70)
    expect(r.decisions.some((d) => d.title.includes('加碼 MSTR'))).toBe(true)
  })
  it('過熱區目標 MSTR 0% 且紅燈', () => {
    const r = decideAllocation({ ...base, cycleScore: 95, mnav: 0.9, btcValueUsd: 15000, mstrValueUsd: 15000 })
    expect(r.targetMstrShare).toBe(0)
    expect(r.overall).toBe('red')
  })
  it('資料過期顯示灰燈', () => {
    const r = decideAllocation({ ...base, anyStale: true, cycleScore: 40, mnav: 1.8, btcValueUsd: 12500, mstrValueUsd: 12500 })
    expect(r.overall).toBe('gray')
  })
  it('mNAV 偏貴時降低 MSTR 目標', () => {
    const cheap = decideAllocation({ ...base, cycleScore: 50, mnav: 1.2, btcValueUsd: 1, mstrValueUsd: 1 })
    const pricey = decideAllocation({ ...base, cycleScore: 50, mnav: 3, btcValueUsd: 1, mstrValueUsd: 1 })
    expect(cheap.targetMstrShare - pricey.targetMstrShare).toBe(25)
  })
})
