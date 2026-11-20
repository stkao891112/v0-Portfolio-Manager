import { describe, it, expect } from 'vitest'
import {
  evaluateOverride,
  validateOverrideReason,
  buildDecisionSnapshot,
  type SnapshotSourceState,
} from '@/lib/strategies/decision-snapshot'

const base: SnapshotSourceState = {
  currentPhase: 'SNIPER',
  soxxDrawdown: -42,
  soxlPrice: 12,
  tranches: [
    { tranche: 1, status: 'EXECUTED' },
    { tranche: 2, status: 'CANDIDATE' },
    { tranche: 3, status: 'WAITING' },
  ],
  activeSignal: { type: 'BUY_CANDIDATE', title: '第 2 批可買', reason: 'x', canExecuteBuy: true, isStaleData: false },
  exitAlerts: { ma40BreakdownWarning: false },
}

describe('evaluateOverride', () => {
  it('買進已解鎖批次且訊號允許 → 不是覆寫', () => {
    expect(evaluateOverride({ action: 'BUY', tranche: 2 }, base)).toEqual({ isOverride: false, violations: [] })
  })
  it('買進未解鎖或已執行批次 → 覆寫', () => {
    expect(evaluateOverride({ action: 'BUY', tranche: 3 }, base).violations).toContain('第 3 批尚未解鎖')
    expect(evaluateOverride({ action: 'BUY', tranche: 1 }, base).violations).toContain('第 1 批已執行過')
  })
  it('訊號不允許買進 → 覆寫', () => {
    const s = { ...base, activeSignal: { ...base.activeSignal!, type: 'WARNING', title: '總經紅燈', canExecuteBuy: false } }
    expect(evaluateOverride({ action: 'BUY', tranche: 2 }, s).isOverride).toBe(true)
  })
  it('賣出：停利訊號或 40 週線跌破警示才合規', () => {
    expect(evaluateOverride({ action: 'SELL' }, base).isOverride).toBe(true)
    const sell = { ...base, activeSignal: { ...base.activeSignal!, type: 'SELL_CANDIDATE' } }
    expect(evaluateOverride({ action: 'SELL' }, sell).isOverride).toBe(false)
    const warn = { ...base, activeSignal: { ...base.activeSignal!, type: 'WARNING' }, exitAlerts: { ma40BreakdownWarning: true } }
    expect(evaluateOverride({ action: 'SELL' }, warn).isOverride).toBe(false)
  })
  it('資料過期或算不出策略 → 覆寫', () => {
    const stale = { ...base, activeSignal: { ...base.activeSignal!, isStaleData: true } }
    expect(evaluateOverride({ action: 'BUY', tranche: 2 }, stale).violations).toContain('行情資料過期')
    expect(evaluateOverride({ action: 'BUY', tranche: 2 }, null).isOverride).toBe(true)
  })
})

describe('validateOverrideReason', () => {
  const v = { isOverride: true, violations: ['第 3 批尚未解鎖'] }
  it('覆寫時理由至少 10 字', () => {
    expect(validateOverrideReason(v, '想買')).toMatch(/至少 10 個字/)
    expect(validateOverrideReason(v, '   ')).not.toBeNull()
    expect(validateOverrideReason(v, '財報優於預期，提前布局第三批')).toBeNull()
  })
  it('非覆寫不需理由', () => {
    expect(validateOverrideReason({ isOverride: false, violations: [] }, undefined)).toBeNull()
  })
})

describe('buildDecisionSnapshot', () => {
  it('保存當下訊號、指標與覆寫理由', () => {
    const v = evaluateOverride({ action: 'BUY', tranche: 3 }, base)
    const snap = buildDecisionSnapshot(base, v, '  財報優於預期，提前布局  ', new Date('2026-11-20T00:00:00Z'))
    expect(snap.capturedAt).toBe('2026-11-20T00:00:00.000Z')
    expect(snap.signal?.type).toBe('BUY_CANDIDATE')
    expect(snap.soxxDrawdown).toBe(-42)
    expect(snap.soxxPrice).toBeNull()
    expect(snap.tranches).toHaveLength(3)
    expect(snap.override).toEqual({ isOverride: true, violations: ['第 3 批尚未解鎖'], reason: '財報優於預期，提前布局' })
  })
  it('合規交易不存理由', () => {
    const v = evaluateOverride({ action: 'BUY', tranche: 2 }, base)
    expect(buildDecisionSnapshot(base, v, '隨便寫').override.reason).toBeNull()
  })
})
