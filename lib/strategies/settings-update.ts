/**
 * 前端調參面板：驗證使用者送來的 SOXL 參數
 * - 只接受 sanitizeSoxlOverrides 認可的欄位；任何欄位不合法就整筆退回（不默默忽略）
 * - 每批 × 批數不可超過上限、停利累計比例需遞增且最後一階 = 100%
 */
import { DEFAULT_SOXL_CONFIG, resolveSoxlConfig, sanitizeSoxlOverrides, type SoxlStrategyConfig } from './config'

export const EDITABLE_SOXL_FIELDS = [
  'maxPositionPercent',
  'tranchePercent',
  'trancheCount',
  'activateDrawdown',
  'earlyUnlockDrawdowns',
  'intervalWeeks',
  'exitTiers',
  'stopLossMa40Weeks',
] as const

export class SoxlSettingsError extends Error {}

export function validateSoxlSettingsUpdate(raw: unknown): SoxlStrategyConfig {
  if (!raw || typeof raw !== 'object') throw new SoxlSettingsError('參數格式錯誤')
  const r = raw as Record<string, unknown>
  const clean = sanitizeSoxlOverrides(r) as Record<string, unknown>
  const rejected = EDITABLE_SOXL_FIELDS.filter((k) => r[k] !== undefined && clean[k] === undefined)
  if (rejected.length > 0) throw new SoxlSettingsError(`以下參數不合法：${rejected.join('、')}`)

  const merged = resolveSoxlConfig(clean as Partial<SoxlStrategyConfig>)
  if (typeof clean.tranchePercent === 'number' && merged.tranchePercent !== clean.tranchePercent) {
    throw new SoxlSettingsError(
      `每批 ${clean.tranchePercent}% × ${merged.trancheCount} 批超過上限 ${merged.maxPositionPercent}%`
    )
  }
  if (merged.earlyUnlockDrawdowns.length > merged.trancheCount) {
    throw new SoxlSettingsError('提前解鎖門檻數量不可多於批數')
  }
  for (let i = 1; i < merged.earlyUnlockDrawdowns.length; i++) {
    if (merged.earlyUnlockDrawdowns[i] >= merged.earlyUnlockDrawdowns[i - 1]) {
      throw new SoxlSettingsError('提前解鎖門檻必須一批比一批跌得更深（例如 -40、-50、-60）')
    }
  }
  const tiers = merged.exitTiers
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].cumulativeSellRatio <= tiers[i - 1].cumulativeSellRatio) {
      throw new SoxlSettingsError('停利各階的累計賣出比例必須遞增')
    }
  }
  if (Math.abs(tiers[tiers.length - 1].cumulativeSellRatio - 1) > 1e-9) {
    throw new SoxlSettingsError('最後一階停利必須累計賣出 100%')
  }
  return merged
}

export { DEFAULT_SOXL_CONFIG }
