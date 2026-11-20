import { describe, it, expect } from 'vitest'
import { validateSoxlSettingsUpdate, SoxlSettingsError } from '@/lib/strategies/settings-update'

describe('validateSoxlSettingsUpdate', () => {
  it('合法參數：上限 8%、4 批 → 每批自動 2%', () => {
    const c = validateSoxlSettingsUpdate({ maxPositionPercent: 8 })
    expect(c.maxPositionPercent).toBe(8)
    expect(c.tranchePercent).toBe(2)
  })
  it('每批 × 批數超過上限 → 拒絕', () => {
    expect(() => validateSoxlSettingsUpdate({ maxPositionPercent: 10, tranchePercent: 3, trancheCount: 4 })).toThrow(/超過上限/)
  })
  it('不合法欄位整筆退回，不默默忽略', () => {
    expect(() => validateSoxlSettingsUpdate({ activateDrawdown: 10 })).toThrow(SoxlSettingsError)
    expect(() => validateSoxlSettingsUpdate({ trancheCount: 2.5 })).toThrow(/trancheCount/)
    expect(() => validateSoxlSettingsUpdate(null)).toThrow(SoxlSettingsError)
  })
  it('提前解鎖門檻須遞減且不多於批數', () => {
    expect(() => validateSoxlSettingsUpdate({ earlyUnlockDrawdowns: [-40, -30] })).toThrow(/跌得更深/)
    expect(() => validateSoxlSettingsUpdate({ trancheCount: 2, earlyUnlockDrawdowns: [-40, -50, -60] })).toThrow(/多於批數/)
  })
  it('停利累計比例遞增且最後一階 100%', () => {
    expect(() =>
      validateSoxlSettingsUpdate({ exitTiers: [{ gainPercent: 80, cumulativeSellRatio: 0.5 }, { gainPercent: 150, cumulativeSellRatio: 0.8 }] })
    ).toThrow(/100%/)
    expect(() =>
      validateSoxlSettingsUpdate({ exitTiers: [{ gainPercent: 80, cumulativeSellRatio: 0.6 }, { gainPercent: 150, cumulativeSellRatio: 0.5 }, { gainPercent: 200, cumulativeSellRatio: 1 }] })
    ).toThrow(/遞增/)
    const ok = validateSoxlSettingsUpdate({ exitTiers: [{ gainPercent: 100, cumulativeSellRatio: 0.5 }, { gainPercent: 200, cumulativeSellRatio: 1 }] })
    expect(ok.exitTiers.map((t) => t.tier)).toEqual([1, 2])
  })
})
