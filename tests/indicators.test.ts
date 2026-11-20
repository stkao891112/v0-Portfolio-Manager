import { describe, it, expect } from 'vitest'
import {
  calculateSMA,
  calculateDrawdown,
  analyzeSoxxIndicators,
  applyLiveQuoteToBars,
  calculateAnnualizedVolatility,
  calculateAtrPercent,
} from '../lib/strategies/indicators'
import { PriceBar } from '../lib/market-data/provider-interface'

describe('Technical Indicators Calculation Tests', () => {
  it('計算年化對數報酬波動率與 ATR%，資料不足回傳 null', () => {
    expect(calculateAnnualizedVolatility([100, 100, 100], 2)).toBe(0)
    expect(calculateAnnualizedVolatility([100], 2)).toBeNull()
    const bars: PriceBar[] = Array.from({ length: 4 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: 10,
      high: 12,
      low: 8,
      close: 10,
      volume: 0,
      isClosed: true,
    }))
    expect(calculateAtrPercent(bars, 3)).toBe(40)
    expect(calculateAtrPercent(bars.slice(0, 3), 3)).toBeNull()
  })

  it('should correctly calculate Simple Moving Average (SMA)', () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const sma3 = calculateSMA(data, 3)

    expect(sma3[0]).toBeNull()
    expect(sma3[1]).toBeNull()
    expect(sma3[2]).toBe(20) // (10+20+30)/3
    expect(sma3[3]).toBe(30) // (20+30+40)/3
    expect(sma3[9]).toBe(90) // (80+90+100)/3
  })

  it('should accurately calculate percentage drawdown from cycle peak', () => {
    expect(calculateDrawdown(240, 320)).toBe(-25.0)
    expect(calculateDrawdown(192, 320)).toBe(-40.0)
    expect(calculateDrawdown(176, 320)).toBe(-45.0)
    expect(calculateDrawdown(160, 320)).toBe(-50.0)
    expect(calculateDrawdown(320, 320)).toBe(0.0)
  })

  it('should correctly evaluate SOXX indicator state machine on synthetic weekly bars', () => {
    // Generate 45 synthetic weekly bars
    const bars: PriceBar[] = []
    const baseDate = new Date('2023-01-01')

    for (let i = 0; i < 45; i++) {
      const d = new Date(baseDate.getTime() + i * 7 * 24 * 3600 * 1000)
      // Simulating a decline from peak 300 down to 180 (-40%)
      const price = 300 - i * 2.5
      bars.push({
        timestamp: d.toISOString(),
        open: price + 1,
        high: price + 2,
        low: price - 2,
        close: price,
        volume: 1000000,
        isClosed: true,
      })
    }

    const analysis = analyzeSoxxIndicators(bars, 300)
    expect(analysis.cyclePeak).toBe(300)
    expect(analysis.currentPrice).toBe(bars[bars.length - 1].close)
    expect(analysis.drawdownPercent).toBeLessThan(0)
    expect(analysis.ma10w).toBeDefined()
    expect(analysis.ma40w).toBeDefined()
    expect(analysis.atr14wPercent).not.toBeNull()
    expect(analysis.volatility20dPercent).toBeNull()
    expect(typeof analysis.isStabilizing).toBe('boolean')
  })

  const WEEK = 7 * 24 * 3600 * 1000
  const mk = (closes: number[], lastClosed: boolean): PriceBar[] =>
    closes.map((c, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 5) + i * WEEK).toISOString(),
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
      isClosed: i < closes.length - 1 ? true : lastClosed,
    }))

  it('isBreakout4wHigh 盤中邊界：最新週未收盤時，前 4 週要包含上週收盤', () => {
    // 已收盤：100,100,100,100,100,120（上週）；本週盤中 115 → 沒有突破上週 120
    const intraday = analyzeSoxxIndicators(mk([100, 100, 100, 100, 100, 120, 115], false), 200)
    expect(intraday.isCurrentBarConfirmed).toBe(false)
    expect(intraday.isBreakout4wHigh).toBe(false) // 舊版 slice(-5,-1) 漏掉上週 120 → 誤判 true

    // 本週盤中 121 → 突破上週 120
    expect(analyzeSoxxIndicators(mk([100, 100, 100, 100, 100, 120, 121], false), 200).isBreakout4wHigh).toBe(true)
  })

  it('isBreakout4wHigh 已收盤：前 4 週不含本週自己', () => {
    const closed = analyzeSoxxIndicators(mk([100, 100, 100, 100, 120, 125], true), 200)
    expect(closed.isCurrentBarConfirmed).toBe(true)
    expect(closed.isBreakout4wHigh).toBe(true)
    const notBreak = analyzeSoxxIndicators(mk([100, 100, 100, 130, 120, 125], true), 200)
    expect(notBreak.isBreakout4wHigh).toBe(false)
  })

  it('即時報價覆蓋最新一根盤中週 K；已收盤則補一根未收盤 K 棒；過期報價不使用', () => {
    const open = mk([100, 110], false)
    const t = new Date(new Date(open[1].timestamp).getTime() + 2 * 24 * 3600 * 1000).toISOString()
    const a = applyLiveQuoteToBars(open, { price: 90, timestamp: t, isStale: false })
    expect(a[1].close).toBe(90)
    expect(a[1].low).toBe(90)
    expect(open[1].close).toBe(110) // 不修改原陣列

    const closed = mk([100, 110], true)
    const t2 = new Date(new Date(closed[1].timestamp).getTime() + 8 * 24 * 3600 * 1000).toISOString()
    const b = applyLiveQuoteToBars(closed, { price: 95, timestamp: t2, isStale: false })
    expect(b).toHaveLength(3)
    expect(b[2].isClosed).toBe(false)
    expect(analyzeSoxxIndicators(b, 200).isCurrentBarConfirmed).toBe(false)

    expect(applyLiveQuoteToBars(open, { price: 90, timestamp: t, isStale: true })).toBe(open)
  })
})
