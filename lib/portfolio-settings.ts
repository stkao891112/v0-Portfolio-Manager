/**
 * portfolio_settings 局部更新（Partial Update）：只覆蓋這次有送來、且格式正確的欄位，
 * 避免「只改幣別」卻把每月投入金額、緊急預備金、SOXL 參數洗回預設值。
 */
export interface PortfolioSettings {
  displayCurrency: 'TWD' | 'USD'
  exchangeRate: number
  monthlyInvestmentAmount: number
  emergencyFundAmount: number
  soxlReserveTargetPercent: number
  soxlMaxPositionPercent: number
  /** MSTR 淨負債（USD，非負，預設 0） */
  mstrNetDebtUsd?: number
  /** MSTR 特別股（USD，非負，預設 0） */
  mstrPreferredStockUsd?: number
  /** MSTR 完全稀釋股數手動覆寫（正數；null = 不覆寫） */
  mstrDilutedSharesOverride?: number | null
}

export class SettingsValidationError extends Error {}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)

export function mergePortfolioSettings(existing: PortfolioSettings, patch: Record<string, unknown>): PortfolioSettings {
  const next = { ...existing }

  if (patch.displayCurrency !== undefined) {
    if (patch.displayCurrency !== 'TWD' && patch.displayCurrency !== 'USD') {
      throw new SettingsValidationError('顯示幣別只能是 TWD 或 USD')
    }
    next.displayCurrency = patch.displayCurrency
  }

  const positive = (key: keyof PortfolioSettings, label: string, max = Infinity) => {
    if (patch[key] === undefined || patch[key] === null) return
    const v = num(patch[key])
    if (!Number.isFinite(v) || v <= 0 || v > max) throw new SettingsValidationError(`${label}必須是大於 0 的數字`)
    ;(next as any)[key] = v
  }
  const nonNegative = (key: keyof PortfolioSettings, label: string) => {
    if (patch[key] === undefined || patch[key] === null) return
    const v = num(patch[key])
    if (!Number.isFinite(v) || v < 0) throw new SettingsValidationError(`${label}不可為負數`)
    ;(next as any)[key] = v
  }

  positive('exchangeRate', '匯率')
  nonNegative('monthlyInvestmentAmount', '每月投入金額')
  nonNegative('emergencyFundAmount', '緊急預備金')
  positive('soxlReserveTargetPercent', 'SOXL 預備金目標比例', 100)
  positive('soxlMaxPositionPercent', 'SOXL 持倉上限', 100)
  nonNegative('mstrNetDebtUsd', 'MSTR 淨負債')
  nonNegative('mstrPreferredStockUsd', 'MSTR 特別股')

  // 稀釋股數覆寫：明確送 null（或空字串）= 清除覆寫；其他值必須是正數
  if (patch.mstrDilutedSharesOverride !== undefined) {
    const raw = patch.mstrDilutedSharesOverride
    if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      next.mstrDilutedSharesOverride = null
    } else {
      const v = num(raw)
      if (!Number.isFinite(v) || v <= 0) throw new SettingsValidationError('MSTR 稀釋股數覆寫必須是大於 0 的數字，或 null')
      next.mstrDilutedSharesOverride = v
    }
  }

  return next
}
