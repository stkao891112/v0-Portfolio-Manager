import { PriceBar } from '../market-data/provider-interface'

export interface SoxxIndicatorAnalysis {
  currentPrice: number
  cyclePeak: number
  drawdownPercent: number
  ma10w: number | null
  ma40w: number | null
  distanceToMa10wPercent: number | null
  distanceToMa40wPercent: number | null
  isAboveMa10w: boolean
  isAboveMa40w: boolean
  isBelow40wTwoWeeks: boolean
  isBreakout4wHigh: boolean
  isNewLowWeekly: boolean
  isHigherLow: boolean
  lastConfirmedWeeklyClose: number
  isCurrentBarConfirmed: boolean
  marketPhase: 'NORMAL' | 'CORRECTION' | 'BEAR_WATCH' | 'DEEP_BEAR' | 'EXTREME_CORRECTION' | 'EXTREME_PANIC'
}

/**
 * Calculates Simple Moving Average (SMA)
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      const slice = data.slice(i - period + 1, i + 1)
      const sum = slice.reduce((acc, val) => acc + val, 0)
      result.push(Number((sum / period).toFixed(2)))
    }
  }
  return result
}

/**
 * Calculates Drawdown Percentage from Cycle Peak
 * Drawdown = Current / CyclePeak - 1
 */
export function calculateDrawdown(currentPrice: number, cyclePeak: number): number {
  if (cyclePeak <= 0) return 0
  return Number(((currentPrice / cyclePeak - 1) * 100).toFixed(2))
}

/**
 * Comprehensive technical indicator engine for SOXX weekly series
 */
export function analyzeSoxxIndicators(
  bars: PriceBar[],
  customCyclePeak?: number,
  cycleAnchorDate?: string
): SoxxIndicatorAnalysis {
  if (!bars || bars.length === 0) {
    return {
      currentPrice: 0,
      cyclePeak: customCyclePeak || 0,
      drawdownPercent: 0,
      ma10w: null,
      ma40w: null,
      distanceToMa10wPercent: null,
      distanceToMa40wPercent: null,
      isAboveMa10w: false,
      isAboveMa40w: false,
      isBelow40wTwoWeeks: false,
      isBreakout4wHigh: false,
      isNewLowWeekly: false,
      isHigherLow: false,
      lastConfirmedWeeklyClose: 0,
      isCurrentBarConfirmed: false,
      marketPhase: 'NORMAL',
    }
  }

  // Filter bars if cycleAnchorDate is provided
  let activeBars = bars
  if (cycleAnchorDate) {
    const anchorTime = new Date(cycleAnchorDate).getTime()
    activeBars = bars.filter((b) => new Date(b.timestamp).getTime() >= anchorTime)
    if (activeBars.length === 0) activeBars = bars
  }

  const closes = bars.map((b) => b.close)
  const currentBar = bars[bars.length - 1]
  const currentPrice = currentBar.close
  const isCurrentBarConfirmed = currentBar.isClosed

  // Calculate 10W and 40W SMA
  const ma10Series = calculateSMA(closes, 10)
  const ma40Series = calculateSMA(closes, 40)

  const ma10w = ma10Series[ma10Series.length - 1]
  const ma40w = ma40Series[ma40Series.length - 1]

  // Calculate Cycle Peak from confirmed closed bars or custom anchor
  const confirmedBars = activeBars.filter((b) => b.isClosed)
  let calculatedPeak = confirmedBars.length > 0 ? Math.max(...confirmedBars.map((b) => b.close)) : currentPrice
  const cyclePeak = customCyclePeak && customCyclePeak > 0 ? customCyclePeak : calculatedPeak

  // Drawdown
  const drawdownPercent = calculateDrawdown(currentPrice, cyclePeak)

  // Distance to MAs
  const distanceToMa10wPercent = ma10w ? Number((((currentPrice - ma10w) / ma10w) * 100).toFixed(2)) : null
  const distanceToMa40wPercent = ma40w ? Number((((currentPrice - ma40w) / ma40w) * 100).toFixed(2)) : null

  const isAboveMa10w = ma10w !== null && currentPrice >= ma10w
  const isAboveMa40w = ma40w !== null && currentPrice >= ma40w

  // Check if SOXX has been below 40W MA for 2 consecutive confirmed weeks
  let isBelow40wTwoWeeks = false
  if (confirmedBars.length >= 2 && ma40Series.length >= 2) {
    const lastBar = confirmedBars[confirmedBars.length - 1]
    const prevBar = confirmedBars[confirmedBars.length - 2]
    const lastMa40 = ma40Series[ma40Series.length - (currentBar.isClosed ? 1 : 2)]
    const prevMa40 = ma40Series[ma40Series.length - (currentBar.isClosed ? 2 : 3)]

    if (lastMa40 && prevMa40 && lastBar.close < lastMa40 && prevBar.close < prevMa40) {
      isBelow40wTwoWeeks = true
    }
  }

  // Breakout of previous 4 weeks highest weekly close
  let isBreakout4wHigh = false
  if (confirmedBars.length >= 5) {
    const prev4Bars = confirmedBars.slice(-5, -1)
    const prev4HighClose = Math.max(...prev4Bars.map((b) => b.close))
    isBreakout4wHigh = currentPrice > prev4HighClose
  }

  // Low checking
  let isNewLowWeekly = false
  let isHigherLow = false
  if (confirmedBars.length >= 3) {
    const recentLows = confirmedBars.slice(-10).map((b) => b.low)
    const minLow = Math.min(...recentLows)
    isNewLowWeekly = currentBar.low <= minLow

    const lastLow = confirmedBars[confirmedBars.length - 1].low
    const prevLow = confirmedBars[confirmedBars.length - 2].low
    isHigherLow = lastLow > prevLow
  }

  // Market phase mapping based on ChatGPT rules:
  // -20%: 一般修正 (CORRECTION)
  // -30%: 熊市警戒 (BEAR_WATCH)
  // -40%: 深度熊市 / 第一批候選 (DEEP_BEAR)
  // -45%: 極端修正 / 第二批候選 (EXTREME_CORRECTION)
  // -50%: 極端悲觀 / 第三批候選 (EXTREME_PANIC)
  let marketPhase: SoxxIndicatorAnalysis['marketPhase'] = 'NORMAL'
  if (drawdownPercent <= -50) {
    marketPhase = 'EXTREME_PANIC'
  } else if (drawdownPercent <= -45) {
    marketPhase = 'EXTREME_CORRECTION'
  } else if (drawdownPercent <= -40) {
    marketPhase = 'DEEP_BEAR'
  } else if (drawdownPercent <= -30) {
    marketPhase = 'BEAR_WATCH'
  } else if (drawdownPercent <= -20) {
    marketPhase = 'CORRECTION'
  }

  const lastConfirmedWeeklyClose = confirmedBars.length > 0 ? confirmedBars[confirmedBars.length - 1].close : currentPrice

  return {
    currentPrice,
    cyclePeak,
    drawdownPercent,
    ma10w,
    ma40w,
    distanceToMa10wPercent,
    distanceToMa40wPercent,
    isAboveMa10w,
    isAboveMa40w,
    isBelow40wTwoWeeks,
    isBreakout4wHigh,
    isNewLowWeekly,
    isHigherLow,
    lastConfirmedWeeklyClose,
    isCurrentBarConfirmed,
    marketPhase,
  }
}
