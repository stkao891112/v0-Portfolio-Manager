import { PriceBar, Quote } from '../market-data/provider-interface'

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
  ma10wSlopePercent: number | null
  isStabilizing: boolean
  atr14wPercent: number | null
  volatility20dPercent: number | null
  volatility60dPercent: number | null
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

/** 對數報酬率的年化波動率（母體標準差，百分比）。 */
export function calculateAnnualizedVolatility(closes: number[], window: number): number | null {
  if (!Number.isInteger(window) || window <= 0 || closes.length < window + 1) return null
  const sample = closes.slice(-(window + 1))
  if (sample.some((close) => !(close > 0) || !Number.isFinite(close))) return null
  const returns = sample.slice(1).map((close, i) => Math.log(close / sample[i]))
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
  return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2))
}

/** 最近 period 根 K 棒的平均真實波幅，占最新收盤價百分比。 */
export function calculateAtrPercent(bars: PriceBar[], period = 14): number | null {
  if (!Number.isInteger(period) || period <= 0 || bars.length < period + 1) return null
  const sample = bars.slice(-(period + 1))
  const ranges = sample.slice(1).map((bar, i) => {
    const previousClose = sample[i].close
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
  })
  const close = sample[sample.length - 1].close
  if (!(close > 0) || ranges.some((range) => !Number.isFinite(range))) return null
  const atr = ranges.reduce((sum, range) => sum + range, 0) / period
  return Number(((atr / close) * 100).toFixed(2))
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
      ma10wSlopePercent: null,
      isStabilizing: false,
      atr14wPercent: null,
      volatility20dPercent: null,
      volatility60dPercent: null,
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
  const ma10wTwoWeeksAgo = ma10Series.length >= 3 ? ma10Series[ma10Series.length - 3] : null
  const ma10wSlopePercent =
    ma10w !== null && ma10wTwoWeeksAgo !== null && ma10wTwoWeeksAgo !== 0
      ? Number((((ma10w / ma10wTwoWeeksAgo) - 1) * 100).toFixed(2))
      : null

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
  // 「前 4 週」= 目前這根 K 棒之前的 4 根已收盤週線：
  // - 最新一根已收盤 → 它本身就在 confirmedBars 最後，要排除 → slice(-5, -1)
  // - 最新一根是盤中（未收盤）→ 它不在 confirmedBars 裡，最後 4 根已收盤週線就是前 4 週 → slice(-4)
  //   （舊版一律 slice(-5, -1)，盤中時會漏掉上週收盤）
  let isBreakout4wHigh = false
  const prev4Bars = isCurrentBarConfirmed ? confirmedBars.slice(-5, -1) : confirmedBars.slice(-4)
  if (prev4Bars.length === 4) {
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
  const isStabilizing =
    (isHigherLow && !isNewLowWeekly) ||
    (ma10wSlopePercent !== null && ma10wSlopePercent >= -0.5 && isAboveMa10w)

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
    ma10wSlopePercent,
    isStabilizing,
    atr14wPercent: calculateAtrPercent(bars),
    volatility20dPercent: null,
    volatility60dPercent: null,
    lastConfirmedWeeklyClose,
    isCurrentBarConfirmed,
    marketPhase,
  }
}

/**
 * 用即時報價覆蓋最新一根「盤中」週 K 的收盤價（高低點一併延伸），讓回撤、均線距離即時。
 * - 最新一根尚未收盤 → 直接覆蓋
 * - 最新一根已收盤，但報價時間晚於該週 → 補一根「未收盤」的本週 K 棒
 * - 報價過期、無效或比 K 棒舊 → 原樣回傳
 * 不修改傳入的陣列。
 */
export function applyLiveQuoteToBars(bars: PriceBar[], quote: Pick<Quote, 'price' | 'timestamp' | 'isStale'> | null | undefined): PriceBar[] {
  if (!bars.length || !quote || quote.isStale || !(quote.price > 0)) return bars
  const out = bars.slice()
  const last = out[out.length - 1]
  const quoteTime = new Date(quote.timestamp).getTime()
  const lastTime = new Date(last.timestamp).getTime()
  if (!Number.isFinite(quoteTime) || quoteTime < lastTime) return bars

  if (!last.isClosed) {
    out[out.length - 1] = {
      ...last,
      close: quote.price,
      high: Math.max(last.high, quote.price),
      low: Math.min(last.low, quote.price),
    }
    return out
  }

  const WEEK = 7 * 24 * 3600 * 1000
  if (quoteTime - lastTime >= WEEK) {
    out.push({
      timestamp: new Date(quoteTime).toISOString(),
      open: last.close,
      high: Math.max(last.close, quote.price),
      low: Math.min(last.close, quote.price),
      close: quote.price,
      volume: 0,
      isClosed: false,
    })
  }
  return out
}
