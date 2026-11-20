/**
 * 從資料庫讀取 SOXL 策略參數覆寫（伺服器端專用）
 * 優先順序：預設值（config.ts）← strategy_settings.soxl_sniper ← portfolio_settings.soxl_max_position_percent
 */
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist, DEFAULT_PORTFOLIO_SETTINGS } from '@/lib/db/init'
import { resolveSoxlConfig, type SoxlStrategyConfig } from './config'

export interface PortfolioSettingsRow {
  displayCurrency: 'TWD' | 'USD'
  exchangeRate: number
  monthlyInvestmentAmount: number
  emergencyFundAmount: number
  soxlReserveTargetPercent: number
  soxlMaxPositionPercent: number
}

export async function loadPortfolioSettings(): Promise<PortfolioSettingsRow> {
  await ensureTablesExist()
  const row = await sqlite.get<any>("SELECT * FROM portfolio_settings WHERE id = 'default'")
  if (!row) return { ...DEFAULT_PORTFOLIO_SETTINGS }
  return {
    displayCurrency: row.display_currency === 'USD' ? 'USD' : 'TWD',
    exchangeRate: Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : DEFAULT_PORTFOLIO_SETTINGS.exchangeRate,
    monthlyInvestmentAmount: Number(row.monthly_investment_amount) || 0,
    emergencyFundAmount: Number(row.emergency_fund_amount) || 0,
    soxlReserveTargetPercent: Number(row.soxl_reserve_target_percent) || DEFAULT_PORTFOLIO_SETTINGS.soxlReserveTargetPercent,
    soxlMaxPositionPercent: Number(row.soxl_max_position_percent) || DEFAULT_PORTFOLIO_SETTINGS.soxlMaxPositionPercent,
  }
}

export async function loadSoxlConfig(settings?: PortfolioSettingsRow): Promise<SoxlStrategyConfig> {
  await ensureTablesExist()
  let fromStrategy: unknown = undefined
  try {
    const row = await sqlite.get<{ config_json: string }>(
      "SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'"
    )
    if (row) fromStrategy = JSON.parse(row.config_json)
  } catch {
    fromStrategy = undefined
  }
  const s = settings ?? (await loadPortfolioSettings())
  return resolveSoxlConfig(
    fromStrategy as any,
    s.soxlMaxPositionPercent > 0 ? { maxPositionPercent: s.soxlMaxPositionPercent } : undefined
  )
}
