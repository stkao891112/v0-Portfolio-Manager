import { describe, it, expect } from 'vitest'
import { calculateSMA, calculateDrawdown, analyzeSoxxIndicators } from '../lib/strategies/indicators'
import { PriceBar } from '../lib/market-data/provider-interface'

describe('Technical Indicators Calculation Tests', () => {
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
  })
})
