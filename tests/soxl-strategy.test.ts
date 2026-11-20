import { describe, it, expect } from 'vitest'
import { evaluateSoxlSniperStrategy } from '../lib/strategies/soxl-engine'
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
    const state = evaluateSoxlSniperStrategy({
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

    const state = evaluateSoxlSniperStrategy({
      analysis: analysisTranche1,
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
    })

    expect(state.activeSignal.type).toBe('BUY_CANDIDATE')
    expect(state.tranches[0].status).toBe('CANDIDATE')
    expect(state.activeSignal.requiresHumanConfirmation).toBe(true)
  })

  it('should trigger Tier 1 profit taking when SOXL return >= +80%', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: { ...mockSoxlQuote, price: 54.0 }, // cost was 30 -> +80%
      totalPortfolioValue: 100000,
      soxlQuantity: 100,
      soxlCostBasis: 30.0,
      cashAvailable: 5000,
    })

    expect(state.activeSignal.type).toBe('SELL_CANDIDATE')
    expect(state.exitAlerts.tier1Profit80).toBe(true)
    expect(state.activeSignal.suggestedAction).toContain('建倉總量 100 股的 1/3')
  })

  it('should trigger warning when SOXX is below 40W MA for two consecutive confirmed weeks', () => {
    const state = evaluateSoxlSniperStrategy({
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

  it('should flag risk violation if SOXL position exceeds 10% of portfolio', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: mockSoxlQuote, // $30
      totalPortfolioValue: 100000,
      soxlQuantity: 400, // 400 * 30 = $12000 = 12% > 10%
      soxlCostBasis: 30.0,
      cashAvailable: 5000,
    })

    expect(state.riskRulesPassed).toBe(false)
    expect(state.riskViolations.length).toBeGreaterThan(0)
    expect(state.riskViolations[0]).toContain('超過 10.0%')
  })

  it('第 4 批：沒跌過 -40% 時站回均線不觸發', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -10, isAboveMa10w: true, isBreakout4wHigh: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      maxDrawdownSincePeak: -20,
    })
    expect(state.tranches[3].status).toBe('WAITING')
  })

  it('總經亮紅燈時，價格到了也不買', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42, isCurrentBarConfirmed: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      macroVerdict: 'STRUCTURAL',
    })
    expect(state.activeSignal.type).toBe('WARNING')
    expect(state.activeSignal.title).toContain('先不買')
  })

  it('恐慌修正且週線確認 → 買進候選，每批 2.5%', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42, isCurrentBarConfirmed: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
    })
    expect(state.activeSignal.type).toBe('BUY_CANDIDATE')
    expect(state.tranches[0].allocationPercent).toBe(2.5)
  })

  it('再買一批會超過 10% 上限 → 不加碼', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42, isCurrentBarConfirmed: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 300, // 9%
      soxlCostBasis: 30,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
    })
    expect(state.activeSignal.type).toBe('WARNING')
  })

  it('總經資料過期 → 降為人工確認', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42, isCurrentBarConfirmed: true },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
      macroStale: true,
    })
    expect(state.activeSignal.type).toBe('MANUAL_REVIEW_REQUIRED')
  })

  it('狙擊期：盤中曾跌到 -40% 後反彈，第 1 批仍可買，第 2 批滿 4 週才解鎖', () => {
    const common = {
      analysis: { ...baseAnalysis, drawdownPercent: -30, isCurrentBarConfirmed: false },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      maxDrawdownSincePeak: -40.1,
      sniperActivatedAt: '2026-11-05T00:00:00Z',
      macroVerdict: 'PANIC' as const,
    }
    const week2 = evaluateSoxlSniperStrategy({ ...common, now: new Date('2026-11-20') })
    expect(week2.tranches.map((t) => t.status)).toEqual(['CANDIDATE', 'WAITING', 'WAITING', 'WAITING'])
    expect(week2.activeSignal.type).toBe('BUY_CANDIDATE')

    const week5 = evaluateSoxlSniperStrategy({ ...common, executedTranches: [1], now: new Date('2026-12-10') })
    expect(week5.tranches.map((t) => t.status)).toEqual(['EXECUTED', 'CANDIDATE', 'WAITING', 'WAITING'])
  })

  it('狙擊期：跌到 -60% 時第 2、3 批提前解鎖', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -58 },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      maxDrawdownSincePeak: -61,
      sniperActivatedAt: '2026-11-05T00:00:00Z',
      now: new Date('2026-11-12'),
      macroVerdict: 'PANIC',
    })
    expect(state.tranches.slice(0, 3).every((t) => t.status === 'CANDIDATE')).toBe(true)
    expect(state.tranches[3].status).toBe('WAITING')
  })

  it('停利：賣過 1/3 後，+80% 階梯不再重複出現', () => {
    const common = {
      analysis: baseAnalysis,
      soxlQuote: { ...mockSoxlQuote, price: 60 },
      totalPortfolioValue: 1000000,
      soxlCostBasis: 30, // +100%
      cashAvailable: 10000,
    }
    const before = evaluateSoxlSniperStrategy({ ...common, soxlQuantity: 300, cycleBoughtQty: 300, cycleSoldQty: 0 })
    expect(before.activeSignal.title).toContain('第 1 批出場')
    expect(before.activeSignal.suggestedAction).toContain('100 股')

    const after = evaluateSoxlSniperStrategy({ ...common, soxlQuantity: 200, cycleBoughtQty: 300, cycleSoldQty: 100 })
    expect(after.exitAlerts.tier1Profit80).toBe(false)
    expect(after.activeSignal.type).not.toBe('SELL_CANDIDATE')
  })

  it('停利：賣過 1/3 後到 +150%，只提示再賣到 2/3', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: { ...mockSoxlQuote, price: 80 }, // 成本 30 → +167%
      totalPortfolioValue: 1000000,
      soxlQuantity: 200,
      soxlCostBasis: 30,
      cashAvailable: 10000,
      cycleBoughtQty: 300,
      cycleSoldQty: 100,
    })
    expect(state.activeSignal.title).toContain('第 2 批出場')
    expect(state.activeSignal.suggestedAction).toContain('100 股')
  })

  it('第 4 批只靠「站回均線突破」解鎖、但本週 K 未收盤 → 降為需人工判斷（不硬寫 isConfirmed = true）', () => {
    const common = {
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      executedTranches: [1, 2, 3],
      maxDrawdownSincePeak: -45,
      sniperActivatedAt: '2026-11-05T00:00:00Z',
      now: new Date('2026-11-20'),
      macroVerdict: 'PANIC' as const,
    }
    const intraday = evaluateSoxlSniperStrategy({
      ...common,
      analysis: { ...baseAnalysis, drawdownPercent: -30, isAboveMa10w: true, isBreakout4wHigh: true, isCurrentBarConfirmed: false },
    })
    expect(intraday.tranches[3].status).toBe('CANDIDATE')
    expect(intraday.tranches[3].unlockedBy).toBe('breakout')
    expect(intraday.activeSignal.type).toBe('MANUAL_REVIEW_REQUIRED')
    expect(intraday.isCurrentBarConfirmed).toBe(false)
    expect(intraday.riskChecks.find((r) => r.key === 'no_intraday_signal')?.status).toBe('pass')

    const closed = evaluateSoxlSniperStrategy({
      ...common,
      analysis: { ...baseAnalysis, drawdownPercent: -30, isAboveMa10w: true, isBreakout4wHigh: true, isCurrentBarConfirmed: true },
    })
    expect(closed.activeSignal.type).toBe('BUY_CANDIDATE')
  })

  it('6 條風控紀律依實際資料計算（不再全部寫死通過）', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 400, // 12% > 10%
      soxlCostBasis: 30,
      cashAvailable: 5000,
      unassignedBuysThisCycle: 1,
    })
    expect(state.riskChecks).toHaveLength(6)
    const by = Object.fromEntries(state.riskChecks.map((r) => [r.key, r.status]))
    expect(by.max_position).toBe('fail')
    expect(by.tranche_discipline).toBe('warn')
    expect(by.emergency_fund).toBe('warn')
    expect(by.no_leverage).toBe('manual')
    expect(by.human_confirmation).toBe('pass')

    const ok = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 100, // 3%
      soxlCostBasis: 30,
      cashAvailable: 5000,
      executedTranches: [1],
      emergencyFundAmount: 300000,
    })
    const by2 = Object.fromEntries(ok.riskChecks.map((r) => [r.key, r.status]))
    expect(by2.max_position).toBe('pass')
    expect(by2.tranche_discipline).toBe('pass')
    expect(by2.emergency_fund).toBe('pass')
  })

  it('建議股數：買進 = 每批 2.5% ÷ 現價（不超過上限空間）；停利 = 本輪建倉量的 1/3', () => {
    const buy = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42 },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
    })
    expect(buy.suggestedBuyQuantity).toBe(Math.floor(2500 / 30))

    const nearCap = evaluateSoxlSniperStrategy({
      analysis: { ...baseAnalysis, drawdownPercent: -42 },
      soxlQuote: mockSoxlQuote,
      totalPortfolioValue: 100000,
      soxlQuantity: 280, // 8.4% → 只剩 1.6% 空間
      soxlCostBasis: 30,
      cashAvailable: 10000,
      macroVerdict: 'PANIC',
    })
    expect(nearCap.suggestedBuyQuantity).toBe(Math.floor(1600 / 30))

    const sell = evaluateSoxlSniperStrategy({
      analysis: baseAnalysis,
      soxlQuote: { ...mockSoxlQuote, price: 60 },
      totalPortfolioValue: 1000000,
      soxlQuantity: 300,
      soxlCostBasis: 30,
      cashAvailable: 10000,
      cycleBoughtQty: 300,
      cycleSoldQty: 0,
    })
    expect(sell.exitTierReady).toBe(1)
    expect(sell.suggestedSellQuantity).toBe(100)
  })
})
