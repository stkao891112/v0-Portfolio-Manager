import { describe, it, expect } from 'vitest'
import {
  applySplitGuard,
  computeRadarMetrics,
  toCompletedWeeklyCloses,
  wilderRsi,
  lastSma,
  DailyClose,
} from '../lib/market-radar'

const DAY = 24 * 3600 * 1000

function series(start: string, closes: number[], stepDays = 1): DailyClose[] {
  const t0 = new Date(`${start}T01:00:00Z`).getTime()
  return closes.map((c, i) => ({ timestamp: new Date(t0 + i * stepDays * DAY).toISOString(), close: c }))
}

describe('指標', () => {
  it('SMA 與 RSI 邊界', () => {
    expect(lastSma([1, 2, 3, 4], 2)).toBe(3.5)
    expect(lastSma([1, 2], 3)).toBeNull()
    expect(wilderRsi([1, 2, 3], 14)).toBeNull()
    const up = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(wilderRsi(up, 14)).toBe(100)
    const flatUpDown = Array.from({ length: 40 }, (_, i) => (i % 2 ? 101 : 100))
    expect(wilderRsi(flatUpDown, 14)!).toBeGreaterThan(40)
    expect(wilderRsi(flatUpDown, 14)!).toBeLessThan(60)
  })

  it('週線只保留已收盤完整週', () => {
    // 2026-11-02（週一）起連續 23 天 → 11/02、11/09、11/16 三週完整，11/23 那週未收盤
    const bars = series('2026-11-02', Array.from({ length: 23 }, (_, i) => 100 + i))
    const weeks = toCompletedWeeklyCloses(bars, new Date('2026-11-25T12:00:00Z'))
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(weeks[2].close).toBe(100 + 20) // 11/22（週日）的收盤
  })
})

describe('0052 拆股斷層保護', () => {
  const pre = Array.from({ length: 10 }, () => 210)
  const post = Array.from({ length: 10 }, () => 30.5)
  const raw = series('2025-11-07', [...pre, ...post]) // 第 11 筆 = 2025-11-17

  it('偵測到 7 倍斷層時把拆股前價格除以 7', () => {
    const { bars, adjusted } = applySplitGuard(raw, { date: '2025-11-17', ratio: 7 })
    expect(adjusted).toBe(true)
    expect(bars[0].close).toBeCloseTo(30)
    expect(bars[15].close).toBe(30.5)
  })

  it('冪等：已修正的資料不會再除一次', () => {
    const once = applySplitGuard(raw, { date: '2025-11-17', ratio: 7 }).bars
    const twice = applySplitGuard(once, { date: '2025-11-17', ratio: 7 })
    expect(twice.adjusted).toBe(false)
    expect(twice.bars[0].close).toBeCloseTo(30)
  })

  it('比值不在 4.2～11.2 倍內不修正', () => {
    const r = applySplitGuard(series('2025-11-07', [...pre, ...Array.from({ length: 10 }, () => 100)]), {
      date: '2025-11-17',
      ratio: 7,
    })
    expect(r.adjusted).toBe(false)
  })

  it('computeRadarMetrics 對 0052.TW 自動套用，避免假回撤', () => {
    const m = computeRadarMetrics('0052.TW', raw, new Date('2025-12-10T00:00:00Z'))
    expect(m.splitAdjusted).toBe(true)
    expect(m.athPrice).toBeCloseTo(30.5)
    expect(m.drawdownFromAthPct).toBeGreaterThan(-1)
  })
})

describe('computeRadarMetrics', () => {
  it('計算 200MA、回撤與週 RSI', () => {
    const closes = Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i / 10) * 10 + i * 0.05)
    const bars = series('2024-12-02', closes)
    const m = computeRadarMetrics('SOXX', bars, new Date('2026-04-20T00:00:00Z'))
    expect(m.ma200).not.toBeNull()
    expect(m.aboveMa200).toBe(m.latestPrice >= m.ma200!)
    expect(m.athPrice).toBeGreaterThanOrEqual(m.latestPrice)
    expect(m.drawdownFromAthPct).toBeLessThanOrEqual(0)
    expect(m.weeklyRsi14).not.toBeNull()
    expect(m.dailyRsi14).not.toBeNull()
    expect(m.weeklyCloseAboveMa200).not.toBeNull()
  })

  it('沒有資料時丟出錯誤（由 API 包成單一標的錯誤）', () => {
    expect(() => computeRadarMetrics('XXX', [])).toThrow()
  })
})
