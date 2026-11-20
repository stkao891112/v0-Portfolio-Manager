import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  DEFAULT_SOXL_CONFIG,
  resolveSoxlConfig,
  buildSoxlStrategySettingsJson,
  sanitizeSoxlOverrides,
} from '../lib/strategies/config'
import {
  evaluateSoxlSniperStrategy,
  SOXL_MAX_WEIGHT_PERCENT,
  SOXL_TRANCHE_PERCENT,
  SOXL_ACTIVATE_DRAWDOWN,
  SOXL_INTERVAL_WEEKS,
} from '../lib/strategies/soxl-engine'
import { runSoxlBacktest } from '../lib/strategies/backtest'
import { DEFAULT_PORTFOLIO_SETTINGS } from '../lib/db/init'
import type { SoxxIndicatorAnalysis } from '../lib/strategies/indicators'
import { resolvePortfolioSoxlConfig } from '../lib/strategies/config-loader'

const analysis: SoxxIndicatorAnalysis = {
  currentPrice: 180,
  cyclePeak: 300,
  drawdownPercent: -40,
  ma10w: 200,
  ma40w: 240,
  distanceToMa10wPercent: -10,
  distanceToMa40wPercent: -25,
  isAboveMa10w: false,
  isAboveMa40w: false,
  isBelow40wTwoWeeks: false,
  isBreakout4wHigh: false,
  isNewLowWeekly: false,
  isHigherLow: false,
    ma10wSlopePercent: null,
    isStabilizing: false,
    atr14wPercent: null,
    volatility20dPercent: null,
    volatility60dPercent: null,
  lastConfirmedWeeklyClose: 180,
  isCurrentBarConfirmed: true,
  marketPhase: 'DEEP_BEAR',
}
const quote = {
  symbol: 'SOXL',
  price: 30,
  change: 0,
  changePercent: 0,
  volume: 0,
  timestamp: new Date().toISOString(),
  isStale: false,
  source: 'test',
}

describe('SOXL 策略參數單一來源（10% = 2.5% × 4）', () => {
  it('預設值：上限 10%、每批 2.5%、4 批、-40/-50/-60、每 4 週', () => {
    expect(DEFAULT_SOXL_CONFIG.maxPositionPercent).toBe(10)
    expect(DEFAULT_SOXL_CONFIG.tranchePercent).toBe(2.5)
    expect(DEFAULT_SOXL_CONFIG.trancheCount).toBe(4)
    expect(DEFAULT_SOXL_CONFIG.tranchePercent * DEFAULT_SOXL_CONFIG.trancheCount).toBe(
      DEFAULT_SOXL_CONFIG.maxPositionPercent
    )
    expect(DEFAULT_SOXL_CONFIG.activateDrawdown).toBe(-40)
    expect(DEFAULT_SOXL_CONFIG.earlyUnlockDrawdowns).toEqual([-40, -50, -60])
    expect(DEFAULT_SOXL_CONFIG.intervalWeeks).toBe(4)
  })

  it('實盤引擎、回測、資料庫種子、相容常數全部一致', () => {
    const live = evaluateSoxlSniperStrategy({
      analysis,
      soxlQuote: quote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
    })
    expect(live.maxAllowedWeightPercent).toBe(10)
    expect(live.tranches).toHaveLength(4)
    expect(live.tranches.every((t) => t.allocationPercent === 2.5)).toBe(true)
    expect(live.config).toEqual(resolveSoxlConfig())

    const bt = runSoxlBacktest({ soxxBars: [], soxlBars: [] })
    expect(bt.config).toEqual(live.config)

    const seed = buildSoxlStrategySettingsJson()
    expect(seed.maxPositionPercent).toBe(10)
    expect(seed.tranches).toHaveLength(4)
    expect(seed.tranches.every((t) => t.allocationPercent === 2.5)).toBe(true)
    expect(seed.exits).toHaveLength(3)
    expect(DEFAULT_PORTFOLIO_SETTINGS.soxlMaxPositionPercent).toBe(10)

    expect(SOXL_MAX_WEIGHT_PERCENT).toBe(10)
    expect(SOXL_TRANCHE_PERCENT).toBe(2.5)
    expect(SOXL_ACTIVATE_DRAWDOWN).toBe(-40)
    expect(SOXL_INTERVAL_WEEKS).toBe(4)
  })

  it('資料庫種子 JSON 讀回來仍解析成同一份參數', () => {
    const roundTrip = resolveSoxlConfig(JSON.parse(JSON.stringify(buildSoxlStrategySettingsJson())))
    expect(roundTrip).toEqual(resolveSoxlConfig())
  })

  it('README 與定案規格一致（10% = 2.5% × 4，不再出現 1.25% / 5% 上限）', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf-8')
    expect(readme).toContain('上限 10% = 每批 2.5% × 4 批')
    expect(readme).not.toContain('每批 1.25%')
    expect(readme).not.toContain('總資產 5%')
  })

  it('只覆寫上限時，每批自動 = 上限 ÷ 批數；每批 × 批數不得超過上限', () => {
    const c8 = resolveSoxlConfig({ maxPositionPercent: 8 })
    expect(c8.tranchePercent).toBe(2)
    const bad = resolveSoxlConfig({ maxPositionPercent: 8, tranchePercent: 5 })
    expect(bad.tranchePercent * bad.trancheCount).toBeLessThanOrEqual(8)
    // 舊 strategy_settings 的 tranchePercent 2.5 + 系統設定上限 8 → 每批壓回 2
    const layered = resolveSoxlConfig(buildSoxlStrategySettingsJson(), { maxPositionPercent: 8 })
    expect(layered.maxPositionPercent).toBe(8)
    expect(layered.tranchePercent).toBe(2)
  })

  it('系統上限由策略 10% 調成 12% 時，每批跟著等比調整為 3%', () => {
    const adjusted = resolvePortfolioSoxlConfig(
      buildSoxlStrategySettingsJson(),
      { ...DEFAULT_PORTFOLIO_SETTINGS, soxlMaxPositionPercent: 12 }
    )
    expect(adjusted.maxPositionPercent).toBe(12)
    expect(adjusted.trancheCount).toBe(4)
    expect(adjusted.tranchePercent).toBe(3)
  })

  it('覆寫值不合法時忽略', () => {
    expect(sanitizeSoxlOverrides({ maxPositionPercent: -5, trancheCount: 2.5, activateDrawdown: 10 })).toEqual({})
    expect(sanitizeSoxlOverrides(null)).toEqual({})
  })

  it('引擎接受覆寫參數（上限 8% → 每批 2%）', () => {
    const state = evaluateSoxlSniperStrategy({
      analysis,
      soxlQuote: quote,
      totalPortfolioValue: 100000,
      soxlQuantity: 0,
      soxlCostBasis: 0,
      cashAvailable: 10000,
      config: resolveSoxlConfig({ maxPositionPercent: 8 }),
    })
    expect(state.maxAllowedWeightPercent).toBe(8)
    expect(state.tranches[0].allocationPercent).toBe(2)
    expect(state.suggestedBuyQuantity).toBe(Math.floor(2000 / 30))
  })
})
