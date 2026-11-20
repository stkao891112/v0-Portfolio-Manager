import { describe, it, expect } from 'vitest'
import { linearScore, interpolate, scoreCycle, decideAllocation, BTC_CYCLE_CONFIG, monthsSinceLastHalving, calculateEvMnav, calculateRatioZScore } from '../lib/strategies/btc-cycle'

describe('btc-cycle 基本計算', () => {
  it('減半權重為 10%，總權重維持 100%', () => {
    expect(BTC_CYCLE_CONFIG.halving.weight).toBe(10)
    expect(BTC_CYCLE_CONFIG.mvrv.weight + BTC_CYCLE_CONFIG.priceTo200w.weight + BTC_CYCLE_CONFIG.mayer.weight + BTC_CYCLE_CONFIG.fearGreed.weight + BTC_CYCLE_CONFIG.halving.weight).toBe(100)
  })
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

describe('BTC/MSTR 戰術指標', () => {
  it('使用含淨負債與優先股的 EV 計算 mNAV', () => {
    expect(calculateEvMnav({ mstrPrice: 100, dilutedShares: 10, btcHeld: 2, btcPrice: 100, netDebtUsd: 100, preferredStockUsd: 50 })).toBeCloseTo(5.75)
    expect(calculateEvMnav({ mstrPrice: 0, dilutedShares: 10, btcHeld: 2, btcPrice: 100 })).toBeNull()
  })
  it('計算 60 筆 Z-Score，資料不足或零標準差回傳 null', () => {
    expect(calculateRatioZScore(Array(59).fill(1))).toBeNull()
    expect(calculateRatioZScore(Array(60).fill(1))).toBeNull()
    expect(calculateRatioZScore([...Array(59).fill(1), 2])).toBeGreaterThan(2)
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
  it('熊底左側保護將 MSTR 目標上限壓到 60%', () => {
    const r = decideAllocation({ ...base, cycleScore: 10, mnav: 1.2, btcValueUsd: 20, mstrValueUsd: 10, btcBelow200dMa: true, mstrBtcRatioFalling: true })
    expect(r.leftSideProtectionActive).toBe(true)
    expect(r.targetMstrShare).toBe(60)
    expect(r.leftSideProtectionMessage).toContain('60%')
  })
  it('MSTR/BTC 60D Z-Score 達 2 時顯示換倉警示', () => {
    const r = decideAllocation({ ...base, cycleScore: 50, mnav: 1.5, btcValueUsd: 20, mstrValueUsd: 10, mstrBtcZScore60d: 2 })
    expect(r.tacticalSwapAlert.active).toBe(true)
    expect(r.tacticalSwapAlert.zScore).toBe(2)
    expect(r.tacticalSwapAlert.message).toContain('換回 BTC')
  })
})
