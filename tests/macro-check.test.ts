import { describe, it, expect } from 'vitest'
import { sahmRule, yoySeries, tsmc3mmaYoySeries, evaluateMacro } from '../lib/strategies/macro-check'

function revenueRows() {
  const rows: { ym: string; revenue: number }[] = []
  const end = Date.UTC(2026, 2, 1)
  const month = new Date(Date.UTC(2024, 10, 1))
  while (month.getTime() <= end) {
    const year = month.getUTCFullYear()
    const revenue = year === 2024 ? 100 : year === 2025 ? 110 : 121
    rows.push({ ym: `${year}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`, revenue })
    month.setUTCMonth(month.getUTCMonth() + 1)
  }
  return rows
}

describe('macro-check', () => {
  it('Sahm 指標計算', () => {
    const flat = Array(15).fill(4.0)
    expect(sahmRule(flat)).toBe(0)
    const rising = [...Array(12).fill(4.0), 4.5, 4.7, 4.9]
    expect(sahmRule(rising)).toBeCloseTo(0.7, 1)
    expect(sahmRule([4, 4])).toBeNull()
  })
  it('年增率', () => {
    const y = yoySeries([
      { ym: '2025-01', revenue: 100 },
      { ym: '2026-01', revenue: 120 },
    ])
    expect(y[0].yoy).toBeCloseTo(20)
  })
  it('3MMA 年增率比較三個月營收總和並依月份排序', () => {
    const series = tsmc3mmaYoySeries(revenueRows().reverse())
    expect(series.at(-1)?.ym).toBe('2026-03')
    expect(series.at(-1)?.yoy).toBeCloseTo(10)
    expect(series[0].ym).toBe('2026-01')
  })
  const base = {
    unemployment: Array(15).fill(4.0),
    tnx: 4.2,
    irx: 3.8,
    vix: 40,
    hygIefChange3m: -1,
    tsmcRevenue: revenueRows(),
    soxxPeakTo200w: 1.5,
  }
  it('基本面正常 → 恐慌修正', () => {
    expect(evaluateMacro(base).verdict).toBe('PANIC')
  })
  it('台積電連 3 月衰退 → 產業倒退', () => {
    const tsmc = base.tsmcRevenue.map((r) => (r.ym.startsWith('2026') ? { ...r, revenue: 80 } : r))
    expect(evaluateMacro({ ...base, tsmcRevenue: tsmc }).verdict).toBe('STRUCTURAL')
  })
  it('前波過熱但營收正常 → 過熱修正（黃燈）', () => {
    expect(evaluateMacro({ ...base, soxxPeakTo200w: 2.8 }).verdict).toBe('OVERHEAT')
  })
  it('前波過熱且營收轉弱 → 結構性', () => {
    const tsmc = base.tsmcRevenue.map((r) => (r.ym === '2026-03' ? { ...r, revenue: 80 } : r))
    expect(evaluateMacro({ ...base, soxxPeakTo200w: 2.8, tsmcRevenue: tsmc }).verdict).toBe('STRUCTURAL')
  })
  it('Sahm 觸發 → 衰退', () => {
    expect(evaluateMacro({ ...base, unemployment: [...Array(12).fill(4.0), 4.5, 4.7, 4.9] }).verdict).toBe('RECESSION')
  })
  it('台積電營收抓不到 → 不可判成恐慌（UNKNOWN）', () => {
    expect(evaluateMacro({ ...base, tsmcRevenue: null }).verdict).toBe('UNKNOWN')
  })
  it('VIX 恐慌見頂回落為綠燈，衝高時為黃燈', () => {
    const falling = evaluateMacro({ ...base, vix: 40, vix5dHigh: 50 }).checks.find((check) => check.key === 'vix')!
    const rising = evaluateMacro({ ...base, vix: 40, vix5dHigh: 42 }).checks.find((check) => check.key === 'vix')!
    expect(falling.light).toBe('green')
    expect(falling.note).toContain('恐慌見頂回落，較佳狙擊點')
    expect(rising.light).toBe('yellow')
    expect(rising.note).toContain('恐慌衝高中，留意續跌')
  })
  it('缺少任一決定性指標時必須為 UNKNOWN', () => {
    expect(evaluateMacro({ ...base, unemployment: null }).verdict).toBe('UNKNOWN')
    expect(evaluateMacro({ ...base, hygIefChange3m: null }).verdict).toBe('UNKNOWN')
  })
  it('台積電最近一期 3MMA 負成長時標為黃燈', () => {
    const rows = revenueRows().map((row) => row.ym === '2026-03' ? { ...row, revenue: 80 } : row)
    expect(evaluateMacro({ ...base, tsmcRevenue: rows }).checks.find((check) => check.key === 'tsmc')?.light).toBe('yellow')
  })
  it('補充總經指標依門檻標示黃燈', () => {
    const checks = evaluateMacro({ ...base, tnxSlope60d: 0.5, dxyChange60d: 5, soxxQqqChange60d: -10 }).checks
    for (const key of ['tnxSlope60d', 'dxyChange60d', 'soxxQqqChange60d']) {
      expect(checks.find((check) => check.key === key)?.light).toBe('yellow')
    }
    const belowThreshold = evaluateMacro({ ...base, tnxSlope60d: 0.49, dxyChange60d: 4.99, soxxQqqChange60d: -9.99 }).checks
    for (const key of ['tnxSlope60d', 'dxyChange60d', 'soxxQqqChange60d']) {
      expect(belowThreshold.find((check) => check.key === key)?.light).toBe('green')
    }
  })
})
