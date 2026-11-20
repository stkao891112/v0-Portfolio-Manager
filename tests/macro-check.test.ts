import { describe, it, expect } from 'vitest'
import { sahmRule, yoySeries, evaluateMacro } from '../lib/strategies/macro-check'

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
  const base = {
    unemployment: Array(15).fill(4.0),
    tnx: 4.2,
    irx: 3.8,
    vix: 40,
    hygIefChange3m: -1,
    tsmcRevenue: [
      { ym: '2025-08', revenue: 100 }, { ym: '2025-09', revenue: 100 }, { ym: '2025-10', revenue: 100 },
      { ym: '2026-08', revenue: 130 }, { ym: '2026-09', revenue: 130 }, { ym: '2026-10', revenue: 130 },
    ],
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
    const tsmc = base.tsmcRevenue.map((r) => (r.ym === '2026-10' ? { ...r, revenue: 90 } : r))
    expect(evaluateMacro({ ...base, soxxPeakTo200w: 2.8, tsmcRevenue: tsmc }).verdict).toBe('STRUCTURAL')
  })
  it('Sahm 觸發 → 衰退', () => {
    expect(evaluateMacro({ ...base, unemployment: [...Array(12).fill(4.0), 4.5, 4.7, 4.9] }).verdict).toBe('RECESSION')
  })
  it('台積電營收抓不到 → 不可判成恐慌（UNKNOWN）', () => {
    expect(evaluateMacro({ ...base, tsmcRevenue: null }).verdict).toBe('UNKNOWN')
  })
})
