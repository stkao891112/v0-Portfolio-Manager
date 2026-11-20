/**
 * SOXL 熊市狙擊策略：參數的「單一來源」
 *
 * 實盤引擎（soxl-engine.ts）、歷史回測（backtest.ts）、資料庫預設值（lib/db/init.ts）
 * 與說明文件（README.md）全部以這裡的預設值為準；
 * 使用者可以用資料庫 strategy_settings（id = 'soxl_sniper'）的 config_json
 * 或 portfolio_settings.soxl_max_position_percent 覆寫。
 *
 * 定案規格（2026-11-20）：SOXL 上限 10%＝每批 2.5% × 4 批；
 * 盤中跌到 -40% 啟動狙擊期，之後每 4 週解鎖一批；跌到 -50%／-60% 提前解鎖第 2／3 批，
 * 第 4 批可因「站回 10 週均線並突破前 4 週高點」提前解鎖。
 */

export interface SoxlExitTier {
  tier: number
  /** 報酬率達到多少 %（相對平均成本）觸發 */
  gainPercent: number
  /** 本輪累計賣出比例要達到多少（1 = 全部清空） */
  cumulativeSellRatio: number
}

export interface SoxlStrategyConfig {
  /** SOXL 部位占總資產上限 %（10） */
  maxPositionPercent: number
  /** 每批占總資產 %（2.5） */
  tranchePercent: number
  /** 批數（4） */
  trancheCount: number
  /** 盤中回落達此幅度即啟動狙擊期（-40） */
  activateDrawdown: number
  /**
   * 各批「提前解鎖」的回落門檻：第 1 批 = 啟動門檻（-40）、第 2 批 -50、第 3 批 -60。
   * 沒有對應門檻的批次（預設第 4 批）改用「站回 10 週均線＋突破前 4 週高點」提前解鎖。
   */
  earlyUnlockDrawdowns: number[]
  /** 啟動後每隔幾週解鎖下一批（4） */
  intervalWeeks: number
  /** 分批停利 */
  exitTiers: SoxlExitTier[]
  /** SOXX 連續幾週收盤跌破 40 週均線發出退場警示 */
  stopLossMa40Weeks: number
}

export const DEFAULT_SOXL_CONFIG: Readonly<SoxlStrategyConfig> = Object.freeze({
  maxPositionPercent: 10.0,
  tranchePercent: 2.5,
  trancheCount: 4,
  activateDrawdown: -40,
  earlyUnlockDrawdowns: [-40, -50, -60],
  intervalWeeks: 4,
  exitTiers: [
    { tier: 1, gainPercent: 80, cumulativeSellRatio: 1 / 3 },
    { tier: 2, gainPercent: 150, cumulativeSellRatio: 2 / 3 },
    { tier: 3, gainPercent: 200, cumulativeSellRatio: 1 },
  ],
  stopLossMa40Weeks: 2,
})

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 從任意 JSON（資料庫 config_json）取出合法的覆寫值；不合法的欄位一律忽略 */
export function sanitizeSoxlOverrides(raw: unknown): Partial<SoxlStrategyConfig> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<SoxlStrategyConfig> = {}
  if (isNum(r.maxPositionPercent) && r.maxPositionPercent > 0 && r.maxPositionPercent <= 100)
    out.maxPositionPercent = r.maxPositionPercent
  if (isNum(r.tranchePercent) && r.tranchePercent > 0 && r.tranchePercent <= 100)
    out.tranchePercent = r.tranchePercent
  if (isNum(r.trancheCount) && Number.isInteger(r.trancheCount) && r.trancheCount >= 1 && r.trancheCount <= 10)
    out.trancheCount = r.trancheCount
  if (isNum(r.activateDrawdown) && r.activateDrawdown < 0 && r.activateDrawdown > -100)
    out.activateDrawdown = r.activateDrawdown
  if (Array.isArray(r.earlyUnlockDrawdowns) && r.earlyUnlockDrawdowns.every((v) => isNum(v) && v < 0 && v > -100))
    out.earlyUnlockDrawdowns = r.earlyUnlockDrawdowns as number[]
  if (isNum(r.intervalWeeks) && r.intervalWeeks > 0 && r.intervalWeeks <= 52) out.intervalWeeks = r.intervalWeeks
  if (
    Array.isArray(r.exitTiers) &&
    r.exitTiers.length > 0 &&
    r.exitTiers.every(
      (t: any) => t && isNum(t.gainPercent) && t.gainPercent > 0 && isNum(t.cumulativeSellRatio) && t.cumulativeSellRatio > 0 && t.cumulativeSellRatio <= 1
    )
  ) {
    out.exitTiers = (r.exitTiers as any[])
      .map((t, i) => ({ tier: i + 1, gainPercent: t.gainPercent, cumulativeSellRatio: t.cumulativeSellRatio }))
      .sort((a, b) => a.gainPercent - b.gainPercent)
      .map((t, i) => ({ ...t, tier: i + 1 }))
  }
  if (isNum(r.stopLossMa40Weeks) && Number.isInteger(r.stopLossMa40Weeks) && r.stopLossMa40Weeks >= 1)
    out.stopLossMa40Weeks = r.stopLossMa40Weeks
  return out
}

/**
 * 合併預設值與覆寫值，並保證「每批 × 批數 ≤ 上限」。
 * 只覆寫上限、沒指定每批大小時，每批 = 上限 ÷ 批數（例如上限 8% → 每批 2%）。
 */
export function resolveSoxlConfig(...overrides: Array<Partial<SoxlStrategyConfig> | undefined>): SoxlStrategyConfig {
  const merged: SoxlStrategyConfig = {
    ...DEFAULT_SOXL_CONFIG,
    earlyUnlockDrawdowns: [...DEFAULT_SOXL_CONFIG.earlyUnlockDrawdowns],
    exitTiers: DEFAULT_SOXL_CONFIG.exitTiers.map((t) => ({ ...t })),
  }
  let trancheGiven = false
  for (const o of overrides) {
    if (!o) continue
    const clean = sanitizeSoxlOverrides(o)
    if (clean.tranchePercent !== undefined) trancheGiven = true
    Object.assign(merged, clean)
  }
  if (!trancheGiven) {
    merged.tranchePercent = merged.maxPositionPercent / merged.trancheCount
  }
  if (merged.tranchePercent * merged.trancheCount > merged.maxPositionPercent + 1e-9) {
    merged.tranchePercent = merged.maxPositionPercent / merged.trancheCount
  }
  return merged
}

/** 資料庫 strategy_settings 預設內容（init.ts 種子資料用；畫面顯示用的 tranches/exits 由參數推導） */
export function buildSoxlStrategySettingsJson(config: SoxlStrategyConfig = resolveSoxlConfig()) {
  return {
    ...config,
    tranches: Array.from({ length: config.trancheCount }, (_, i) => {
      const k = i + 1
      const early = config.earlyUnlockDrawdowns[i]
      return {
        tranche: k,
        allocationPercent: config.tranchePercent,
        unlockAfterWeeks: config.intervalWeeks * i,
        earlyUnlockDrawdown: early ?? null,
        requireMa10Break: early === undefined,
        label:
          k === 1
            ? `第 1 批：盤中跌到 ${config.activateDrawdown}% 啟動狙擊期即可買進`
            : early !== undefined
            ? `第 ${k} 批：啟動後滿 ${config.intervalWeeks * i} 週，或跌到 ${early}% 提前解鎖`
            : `第 ${k} 批：啟動後滿 ${config.intervalWeeks * i} 週，或站回 10 週均線並突破前 4 週高點`,
      }
    }),
    exits: config.exitTiers.map((t) => ({
      tier: t.tier,
      returnRate: t.gainPercent / 100,
      cumulativeSellRatio: t.cumulativeSellRatio,
      sellAll: t.cumulativeSellRatio >= 1,
      label: `獲利 +${t.gainPercent}%（累計賣出 ${t.cumulativeSellRatio >= 1 ? '全部' : `${Math.round(t.cumulativeSellRatio * 100)}%`}）`,
    })),
  }
}
