import { describe, it, expect } from 'vitest'
import { validateSoxlSettingsUpdate, SoxlSettingsError } from '@/lib/strategies/settings-update'
import { sellPercentToRatio } from '@/lib/strategies/sell-ratio'

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

describe('validateSoxlSettingsUpdate：補強驗證', () => {
  it('第一個提前解鎖門檻不可比啟動回撤淺', () => {
    expect(() => validateSoxlSettingsUpdate({ activateDrawdown: -45, earlyUnlockDrawdowns: [-40, -50] })).toThrow(/啟動回撤/)
    expect(validateSoxlSettingsUpdate({ activateDrawdown: -45, earlyUnlockDrawdowns: [-45, -55] }).activateDrawdown).toBe(-45)
  })
  it('停利獲利門檻不可重複', () => {
    expect(() =>
      validateSoxlSettingsUpdate({
        exitTiers: [
          { gainPercent: 80, cumulativeSellRatio: 0.5 },
          { gainPercent: 80, cumulativeSellRatio: 1 },
        ],
      })
    ).toThrow(/不可重複/)
  })
})

describe('sellPercentToRatio', () => {
  it('100 → 1；超過 100 不截斷（交給後端退回）', () => {
    expect(sellPercentToRatio('100')).toBe(1)
    expect(sellPercentToRatio(50)).toBe(0.5)
    expect(sellPercentToRatio(150)).toBe(1.5)
    expect(() => validateSoxlSettingsUpdate({ exitTiers: [{ gainPercent: 80, cumulativeSellRatio: sellPercentToRatio(150) }] })).toThrow(SoxlSettingsError)
  })
})

