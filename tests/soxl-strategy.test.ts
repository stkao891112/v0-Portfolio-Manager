import { describe, it, expect } from 'vitest'
import { evaluateSoxxSniperStrategy } from '../lib/strategies/soxl-engine'
import { SoxxIndicatorAnalysis } from '../lib/strategies/indicators'
import { Quote } from '../lib/market-data/provider-interface'

describe('SOXL Sniper Strategy State Machine Tests', () => {
  const mockSoxlQuote: Quote = {
    symbol: 'SOXL',
    price: 30.0,
    change: 1.0,
    changePercent: 3.4,
    volume: 5000000,
    timestamp: new Date().toISOString(),
    isStale: false,
    source: 'test',
  }

  const baseAnalysis: SoxxIndicatorAnalysis = {
    currentPrice: 200,
    cyclePeak: 300,
    drawdownPercent: -33.33,
    ma10w: 220,
    ma40w: 240,
    distanceToMa10wPercent: -9.09,
    distanceToMa40wPercent: -16.67,
    isAboveMa10w: false,
    isAboveMa40w: false,
    isBelow40wTwoWeeks: false,
    isBreakout4wHigh: false,
    isNewLowWeekly: false,
    isHigherLow: false,
    lastConfirmedWeeklyClose: 200,
    isCurrentBarConfirmed: true,
    marketPhase: 'BEAR_WATCH',
  }

  it('should remain in WAIT state when drawdown is above -40%', () => {
    const state = evaluateSoxxSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
    })

    expect(state.activeSignal.type).toBe('WAIT')
    expect(state.tranches[0].status).toBe('WAITING')
  })

  it('should trigger Tranche 1 CANDIDATE when drawdown reaches -40%', () => {
    const analysisTranche1: SoxxIndicatorAnalysis = {
      ...baseAnalysis,
      currentPrice: 180,
      drawdownPercent: -40.0,
      marketPhase: 'DEEP_BEAR',
    }

    const state = evaluateSoxxSniperStrategy({
      analysis: analysisTranche1,
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
    })

    expect(state.activeSignal.type).toBe('BUY_CANDIDATE')
    expect(state.tranches[0].status).toBe('CANDIDATE')
    expect(state.activeSignal.requiresHumanConfirmation).toBe(true)
  })

  it('should trigger Tier 1 profit taking when SOXL return >= +80%', () => {
    const state = evaluateSoxxSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: { ...mockSoxlQuote, price: 54.0 }, // cost was 30 -> +80%
      totalPortfolioValue: 100000,
      soxlQuantity: 100,
      soxlCostBasis: 30.0,
      cashAvailable: 5000,
    })

    expect(state.activeSignal.type).toBe('SELL_CANDIDATE')
    expect(state.exitAlerts.tier1Profit80).toBe(true)
    expect(state.activeSignal.suggestedAction).toContain('賣出目前 SOXL 持倉的 1/3')
  })

  it('should trigger warning when SOXX is below 40W MA for two consecutive confirmed weeks', () => {
    const state = evaluateSoxxSniperStrategy({
      analysis: { ...baseAnalysis, isBelow40wTwoWeeks: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 50,
      soxlCostBasis: 30.0,
      cashAvailable: 5000,
    })

    expect(state.activeSignal.type).toBe('WARNING')
    expect(state.activeSignal.title).toContain('結構性惡化退場警報')
  })

  it('should flag risk violation if SOXL position exceeds 5% of portfolio', () => {
    const state = evaluateSoxxSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: mockSoxlQuote, // $30
      totalPortfolioValue: 100000,
      soxlQuantity: 250, // 250 * 30 = $7500 = 7.5% > 5%
      soxlCostBasis: 30.0,
      cashAvailable: 5000,
    })

    expect(state.riskRulesPassed).toBe(false)
    expect(state.riskViolations.length).toBeGreaterThan(0)
    expect(state.riskViolations[0]).toContain('超過 5.0%')
  })
})
