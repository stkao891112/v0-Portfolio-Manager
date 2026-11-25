/**
 * 市場位階計算（純函式，前後端與測試共用）
 *
 * 輸入：日線收盤價序列（由舊到新）
 * 輸出：區間高點回撤、200 日均線距離、日 RSI14、週 RSI14（只計已收盤的完整週）
 */

export const RADAR_SYMBOLS = [
  'BTC-USD',
  'MSTR',
  'SOXX',
  'SOXL',
  'QQQ',
  'QQQM',
  '2330.TW',
  '0052.TW',
  '00830.TW',
] as const

export interface DailyClose {
  /** ISO 時間字串 */
  timestamp: string
  close: number
}

export interface MarketRadarMetrics {
  symbol: string
  latestDate: string
  latestPrice: number
  /** 區間（約 2 年）收盤高點 */
  athPrice: number
  drawdownFromAthPct: number
  ma200: number | null
  distanceToMa200Pct: number | null
  aboveMa200: boolean | null
  dailyRsi14: number | null
  /** 只用已收盤的完整週計算 */
  weeklyRsi14: number | null
  /** 最近一個已收盤完整週的收盤價 */
  lastWeeklyClose: number | null
  /** 最近完整週收盤是否站上當時的 200 日均線 */
  weeklyCloseAboveMa200: boolean | null
  /** 是否套用了拆股斷層修正 */
  splitAdjusted: boolean
}

export interface MarketRadarEntry {
  symbol: string
  ok: boolean
  data?: MarketRadarMetrics
  error?: string
}

export interface MarketRadarResponse {
  generatedAt: string
  cached: boolean
  cacheTtlMinutes: number
  results: MarketRadarEntry[]
}

/** 已知拆股：拆股日、拆股比例 */
export const KNOWN_SPLITS: Record<string, { date: string; ratio: number }> = {
  '0052.TW': { date: '2025-11-17', ratio: 7 },
}

const DAY_MS = 24 * 3600 * 1000

function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/**
 * 拆股斷層保護（冪等）：
 * 在拆股日前後 10 天內，找出「前一交易日 / 當日」比值落在 [ratio×0.6, ratio×1.6]（7 拆 → 4.2～11.2）的斷層，
 * 找到才把斷層前的價格除以 ratio；資料已經是還原價（沒有斷層）時不做任何事。
 */
export function applySplitGuard(
  bars: DailyClose[],
  split: { date: string; ratio: number }
): { bars: DailyClose[]; adjusted: boolean } {
  const splitTime = new Date(`${split.date}T00:00:00Z`).getTime()
  const lo = split.ratio * 0.6
  const hi = split.ratio * 1.6
  for (let i = 1; i < bars.length; i++) {
    const t = new Date(bars[i].timestamp).getTime()
    if (Math.abs(t - splitTime) > 10 * DAY_MS) continue
    const prev = bars[i - 1].close
    const cur = bars[i].close
    if (!(cur > 0) || !(prev > 0)) continue
    const r = prev / cur
    if (r >= lo && r <= hi) {
      const out = bars.map((b, idx) => (idx < i ? { ...b, close: b.close / split.ratio } : b))
      return { bars: out, adjusted: true }
    }
  }
  return { bars, adjusted: false }
}

/** 簡單移動平均（最後一筆）；資料不足回傳 null */
export function lastSma(values: number[], period: number, endIndex = values.length - 1): number | null {
  if (endIndex + 1 < period || endIndex < 0) return null
  let sum = 0
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i]
  return sum / period
}

/** Wilder RSI（最後一筆）；資料不足（少於 period+1 筆）回傳 null */
export function wilderRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** 該時間所在週的週一 00:00 UTC */
function weekStartUtc(t: number): number {
  const d = new Date(t)
  const day = d.getUTCDay() // 0 = 週日
  const diff = (day + 6) % 7 // 距離週一幾天
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - diff * DAY_MS
}

export interface WeeklyClose {
  weekStart: string
  close: number
  /** 該週最後一根日線在日線序列中的索引 */
  lastDailyIndex: number
}

/**
 * 日線 → 週線收盤，只保留「已收盤的完整週」（下週一 00:00 UTC 之後才算收盤）。
 */
export function toCompletedWeeklyCloses(bars: DailyClose[], now = new Date()): WeeklyClose[] {
  const weeks: WeeklyClose[] = []
  for (let i = 0; i < bars.length; i++) {
    const ws = weekStartUtc(new Date(bars[i].timestamp).getTime())
    const key = new Date(ws).toISOString().slice(0, 10)
    const last = weeks[weeks.length - 1]
    if (last && last.weekStart === key) {
      last.close = bars[i].close
      last.lastDailyIndex = i
    } else {
      weeks.push({ weekStart: key, close: bars[i].close, lastDailyIndex: i })
    }
  }
  const nowMs = now.getTime()
  return weeks.filter((w) => new Date(`${w.weekStart}T00:00:00Z`).getTime() + 7 * DAY_MS <= nowMs)
}

/** 由日線計算一檔標的的市場位階 */
export function computeRadarMetrics(
  symbol: string,
  rawBars: DailyClose[],
  now = new Date()
): MarketRadarMetrics {
  const clean = rawBars
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  if (clean.length === 0) throw new Error(`${symbol} 沒有可用的歷史價格`)

  let bars = clean
  let splitAdjusted = false
  const split = KNOWN_SPLITS[symbol.toUpperCase()]
  if (split) {
    const r = applySplitGuard(bars, split)
    bars = r.bars
    splitAdjusted = r.adjusted
  }

  const closes = bars.map((b) => b.close)
  const latest = bars[bars.length - 1]
  const latestPrice = latest.close
  const athPrice = Math.max(...closes)
  const ma200 = lastSma(closes, 200)

  const weekly = toCompletedWeeklyCloses(bars, now)
  const weeklyCloses = weekly.map((w) => w.close)
  const lastWeek = weekly[weekly.length - 1]
  const ma200AtLastWeek = lastWeek ? lastSma(closes, 200, lastWeek.lastDailyIndex) : null

  const dailyRsi = wilderRsi(closes, 14)
  const weeklyRsi = wilderRsi(weeklyCloses, 14)

  return {
    symbol,
    latestDate: latest.timestamp.slice(0, 10),
    latestPrice: round(latestPrice, 4),
    athPrice: round(athPrice, 4),
    drawdownFromAthPct: round((latestPrice / athPrice - 1) * 100),
    ma200: ma200 === null ? null : round(ma200, 4),
    distanceToMa200Pct: ma200 === null ? null : round((latestPrice / ma200 - 1) * 100),
    aboveMa200: ma200 === null ? null : latestPrice >= ma200,
    dailyRsi14: dailyRsi === null ? null : round(dailyRsi, 1),
    weeklyRsi14: weeklyRsi === null ? null : round(weeklyRsi, 1),
    lastWeeklyClose: lastWeek ? round(lastWeek.close, 4) : null,
    weeklyCloseAboveMa200:
      lastWeek && ma200AtLastWeek !== null ? lastWeek.close >= ma200AtLastWeek : null,
    splitAdjusted,
  }
}
