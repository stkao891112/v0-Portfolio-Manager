import { describe, it, expect } from 'vitest'
import { runSoxlBacktest } from '../lib/strategies/backtest'
import { PriceBar } from '../lib/market-data/provider-interface'

describe('Historical Backtest Simulation Tests', () => {
  it('should run backtest simulation and return performance statistics', () => {
    // Generate 60 weekly bars
    const soxxBars: PriceBar[] = []
    const soxlBars: PriceBar[] = []
    const baseDate = new Date('2022-01-01')

    // Scenario: SOXX drops from 300 to 160 (-46.6%) then rebounds to 260
    for (let i = 0; i < 60; i++) {
      const d = new Date(baseDate.getTime() + i * 7 * 24 * 3600 * 1000)
      const soxxPrice = i < 30 ? 300 - i * 4.6 : 160 + (i - 30) * 3.3
      // SOXL 3x leverage with volatility decay
      const soxlPrice = i < 30 ? Math.max(5, 50 - i * 1.4) : 8 + (i - 30) * 1.0

      soxxBars.push({
        timestamp: d.toISOString(),
        open: soxxPrice,
        high: soxxPrice + 2,
        low: soxxPrice - 2,
        close: soxxPrice,
        volume: 2000000,
        isClosed: true,
      })

      soxlBars.push({
        timestamp: d.toISOString(),
        open: soxlPrice,
        high: soxlPrice + 1,
        low: soxlPrice - 1,
        close: soxlPrice,
        volume: 5000000,
        isClosed: true,
      })
    }

    const result = runSoxlBacktest({
      soxxBars,
      soxlBars,
      scenarioName: '測試模擬環境',
    })

    expect(result.initialCapital).toBe(10000)
    expect(result.finalEquity).toBeGreaterThan(0)
    expect(result.trades.length).toBeGreaterThan(0)
    expect(result.trades[0].type).toBe('BUY')
    expect(result.trades[0].reason).toContain('觸發第 1 批進場')
    expect(result.equityCurve.length).toBe(60)
  })
})
