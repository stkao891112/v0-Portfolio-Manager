/**
 * 決策當下情境快照（Decision Snapshot）＋違規覆寫判定
 *
 * 每次人工確認 SOXL 買賣時，把「當下策略引擎的結論與關鍵指標」存進 strategy_signals.indicator_values，
 * 事後可以回頭檢討「當時系統怎麼說、我怎麼做」。
 * 若交易不符合當下規則（例如該批尚未解鎖、訊號不允許買進、停利／退場條件未成立），
 * 視為「違規覆寫」，必須填寫至少 MIN_OVERRIDE_REASON_LENGTH 個字的理由才可寫入。
 */

export const MIN_OVERRIDE_REASON_LENGTH = 10

/** 只取判定與快照需要的欄位（與 SoxlStrategyState 相容的子集） */
export interface SnapshotSourceState {
  currentPhase?: string
  soxxDrawdown?: number
  soxxPrice?: number
  soxlPrice?: number
  soxlCostBasis?: number
  soxlHoldingQuantity?: number
  soxlCurrentReturnPercent?: number
  soxlPortfolioWeightPercent?: number
  maxAllowedWeightPercent?: number
  macroVerdict?: unknown
  exitTierReady?: number | null
  suggestedBuyQuantity?: number
  suggestedSellQuantity?: number
  tranches?: { tranche: number; status: string }[]
  activeSignal?: { type: string; title: string; reason: string; canExecuteBuy?: boolean; isStaleData?: boolean }
  exitAlerts?: { ma40BreakdownWarning?: boolean }
  riskViolations?: string[]
}

export interface TradeIntent {
  action: 'BUY' | 'SELL'
  tranche?: number | null
}

export interface OverrideVerdict {
  /** true = 不符合當下規則，必須填理由 */
  isOverride: boolean
  /** 違反了哪些規則（白話） */
  violations: string[]
}

/** 判斷這筆交易是否違反當下策略規則；state 為 null（策略算不出來）時一律視為覆寫 */
export function evaluateOverride(intent: TradeIntent, state: SnapshotSourceState | null): OverrideVerdict {
  if (!state || !state.activeSignal) {
    return { isOverride: true, violations: ['無法取得當下策略結論（行情或策略計算失敗）'] }
  }
  const v: string[] = []
  const sig = state.activeSignal
  if (sig.isStaleData) v.push('行情資料過期')
  if (intent.action === 'BUY') {
    const t = state.tranches?.find((x) => x.tranche === intent.tranche)
    if (!t) v.push(`找不到第 ${intent.tranche ?? '?'} 批`)
    else if (t.status === 'EXECUTED') v.push(`第 ${t.tranche} 批已執行過`)
    else if (t.status !== 'CANDIDATE') v.push(`第 ${t.tranche} 批尚未解鎖`)
    if (!sig.canExecuteBuy) v.push(`目前訊號「${sig.title}」不允許買進`)
  } else {
    const sellOk = sig.type === 'SELL_CANDIDATE' || (sig.type === 'WARNING' && !!state.exitAlerts?.ma40BreakdownWarning)
    if (!sellOk) v.push(`停利／退場條件未成立（目前訊號「${sig.title}」）`)
  }
  return { isOverride: v.length > 0, violations: [...new Set(v)] }
}

/** 檢查覆寫理由；回傳錯誤訊息，合格回傳 null */
export function validateOverrideReason(verdict: OverrideVerdict, reason: unknown): string | null {
  if (!verdict.isOverride) return null
  const r = typeof reason === 'string' ? reason.trim() : ''
  if (r.length < MIN_OVERRIDE_REASON_LENGTH) {
    return `這筆交易不符合當下策略規則（${verdict.violations.join('；')}），請填寫至少 ${MIN_OVERRIDE_REASON_LENGTH} 個字的覆寫理由`
  }
  return null
}

export interface DecisionSnapshot {
  capturedAt: string
  signal: { type: string; title: string; reason: string } | null
  phase: string | null
  soxxPrice: number | null
  soxxDrawdown: number | null
  soxlPrice: number | null
  soxlCostBasis: number | null
  soxlHoldingQuantity: number | null
  soxlReturnPercent: number | null
  soxlWeightPercent: number | null
  maxWeightPercent: number | null
  exitTierReady: number | null
  suggestedBuyQuantity: number | null
  suggestedSellQuantity: number | null
  tranches: { tranche: number; status: string }[]
  macroVerdict: unknown
  riskViolations: string[]
  override: { isOverride: boolean; violations: string[]; reason: string | null }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function buildDecisionSnapshot(
  state: SnapshotSourceState | null,
  verdict: OverrideVerdict,
  reason: string | null,
  now: Date = new Date()
): DecisionSnapshot {
  const s = state ?? {}
  return {
    capturedAt: now.toISOString(),
    signal: s.activeSignal ? { type: s.activeSignal.type, title: s.activeSignal.title, reason: s.activeSignal.reason } : null,
    phase: s.currentPhase ?? null,
    soxxPrice: num(s.soxxPrice),
    soxxDrawdown: num(s.soxxDrawdown),
    soxlPrice: num(s.soxlPrice),
    soxlCostBasis: num(s.soxlCostBasis),
    soxlHoldingQuantity: num(s.soxlHoldingQuantity),
    soxlReturnPercent: num(s.soxlCurrentReturnPercent),
    soxlWeightPercent: num(s.soxlPortfolioWeightPercent),
    maxWeightPercent: num(s.maxAllowedWeightPercent),
    exitTierReady: s.exitTierReady ?? null,
    suggestedBuyQuantity: num(s.suggestedBuyQuantity),
    suggestedSellQuantity: num(s.suggestedSellQuantity),
    tranches: (s.tranches ?? []).map((t) => ({ tranche: t.tranche, status: t.status })),
    macroVerdict: s.macroVerdict ?? null,
    riskViolations: s.riskViolations ?? [],
    override: {
      isOverride: verdict.isOverride,
      violations: verdict.violations,
      reason: verdict.isOverride ? (reason ?? '').trim() || null : null,
    },
  }
}

/**
 * 取得「當下策略狀態」的來源；預設由 SOXL API 路由自行計算。
 * 測試可替換成固定狀態，避免依賴即時行情。
 */
export const soxlSnapshotSource: { load: null | (() => Promise<SnapshotSourceState | null>) } = { load: null }
