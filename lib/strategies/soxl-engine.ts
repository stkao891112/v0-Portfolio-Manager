import { SoxxIndicatorAnalysis } from './indicators'
import { Quote } from '../market-data/provider-interface'
import type { MacroVerdict } from './macro-check'
import { DEFAULT_SOXL_CONFIG, resolveSoxlConfig, type SoxlStrategyConfig } from './config'

/**
 * 相容舊程式的常數（數值一律來自 lib/strategies/config.ts 的單一預設值）。
 * 新程式請改用 resolveSoxlConfig() 取得（可被資料庫設定覆寫的）參數。
 */
export const SOXL_TRANCHE_PERCENT = DEFAULT_SOXL_CONFIG.tranchePercent
export const SOXL_MAX_WEIGHT_PERCENT = DEFAULT_SOXL_CONFIG.maxPositionPercent
export const SOXL_ACTIVATE_DRAWDOWN = DEFAULT_SOXL_CONFIG.activateDrawdown
export const SOXL_INTERVAL_WEEKS = DEFAULT_SOXL_CONFIG.intervalWeeks

export type SignalType =
  | 'BUY_CANDIDATE'
  | 'SELL_CANDIDATE'
  | 'HOLD'
  | 'WAIT'
  | 'WARNING'
  | 'DATA_STALE'
  | 'MANUAL_REVIEW_REQUIRED'

/** 這一批是因為什麼條件解鎖 */
export type UnlockReason = 'activation' | 'time' | 'drawdown' | 'breakout'

export interface TrancheState {
  tranche: number
  allocationPercent: number // 占總資產 %
  status: 'WAITING' | 'CANDIDATE' | 'CONFIRMED_PENDING_EXECUTION' | 'EXECUTED'
  triggerCondition: string
  unlockedBy: UnlockReason | null
  executedAt?: string
  executedPrice?: number
}

export type RiskCheckStatus = 'pass' | 'fail' | 'warn' | 'manual'

export interface RiskCheck {
  key: string
  rule: string
  status: RiskCheckStatus
  detail: string
}

export interface SoxlStrategyState {
  config: SoxlStrategyConfig
  currentPhase: SoxxIndicatorAnalysis['marketPhase']
  soxxDrawdown: number
  soxxPrice: number
  soxlPrice: number
  soxlCostBasis: number
  soxlHoldingQuantity: number
  soxlCurrentReturnPercent: number
  soxlPortfolioWeightPercent: number
  maxAllowedWeightPercent: number
  /** 計算權重用的總資產（與 SOXL 同幣別：USD） */
  totalPortfolioValue: number
  macroVerdict: MacroVerdict
  cashBufferPercent: number
  effectiveIntervalWeeks: number
  /** 最新一根週 K 是否已正式收盤 */
  isCurrentBarConfirmed: boolean
  tranches: TrancheState[]
  /** 下一批建議買進股數（已扣除距上限的空間） */
  suggestedBuyQuantity: number
  /** 目前成立的停利階梯（1、2、3…），沒有則為 null */
  exitTierReady: number | null
  /** 建議賣出股數（停利或退場警示時） */
  suggestedSellQuantity: number
  activeSignal: {
    type: SignalType
    title: string
    reason: string
    suggestedAction: string
    requiresHumanConfirmation: boolean
    isStaleData: boolean
    canExecuteBuy: boolean
  }
  exitAlerts: {
    tier1Profit80: boolean
    tier2Profit150: boolean
    tier3Profit200: boolean
    ma40BreakdownWarning: boolean
    timeStopWarning26w: boolean
    trailingStopWarning: boolean
  }
  protection: {
    active: boolean
    breakevenStopPrice: number | null
    trailingStopPrice: number | null
    effectiveStopPrice: number | null
  }
  riskRulesPassed: boolean
  riskViolations: string[]
  /** 6 條風控紀律的實際檢查結果 */
  riskChecks: RiskCheck[]
}

export function evaluateSoxlSniperStrategy(params: {
  analysis: SoxxIndicatorAnalysis
  soxlQuote: Quote
  totalPortfolioValue: number
  soxlQuantity: number
  soxlCostBasis: number
  cashAvailable: number
  executedTranches?: number[]
  /** 本輪高點以來最深的回落（%，負數，用盤中低點） */
  maxDrawdownSincePeak?: number
  /** 狙擊期啟動日（盤中第一次跌到 -40% 的日期） */
  sniperActivatedAt?: string | null
  now?: Date
  /** 本次持倉週期（上次持股歸零之後）累計買進股數 */
  cycleBoughtQty?: number
  /** 本次持倉週期累計賣出股數 */
  cycleSoldQty?: number
  macroVerdict?: MacroVerdict
  /** SOXX 報價或週 K 使用過期快取 */
  soxxStale?: boolean
  /** 任一總經資料使用過期快取 */
  macroStale?: boolean
  /** 策略參數（未提供則用預設：上限 10%＝2.5% × 4 批） */
  config?: SoxlStrategyConfig
  /** 系統設定的緊急預備金（不得計入投組） */
  emergencyFundAmount?: number
  /** 本輪高點之後、沒有對應到任何批次的 SOXL 買進筆數 */
  unassignedBuysThisCycle?: number
  volatility20dPercent?: number | null
  soxlPeakPriceSinceEntry?: number
  soxlAtr14d?: number | null
  exchangeRate?: number
}): SoxlStrategyState {
  const {
    analysis,
    soxlQuote,
    totalPortfolioValue,
    soxlQuantity,
    soxlCostBasis,
    cashAvailable,
    executedTranches = [],
    macroVerdict = 'UNKNOWN',
  } = params
  const cfg = params.config ?? resolveSoxlConfig()
  const maxDrawdown = Math.min(params.maxDrawdownSincePeak ?? analysis.drawdownPercent, analysis.drawdownPercent)

  const soxlPrice = soxlQuote.price
  const isStale = soxlQuote.isStale || !!params.soxxStale
  const soxlHoldingValue = soxlQuantity * soxlPrice
  const soxlPortfolioWeightPercent =
    totalPortfolioValue > 0 ? (soxlHoldingValue / totalPortfolioValue) * 100 : 0
  const cashBufferPercent = totalPortfolioValue > 0 ? (cashAvailable / totalPortfolioValue) * 100 : 0

  const soxlCurrentReturnPercent =
    soxlCostBasis > 0 && soxlQuantity > 0 ? ((soxlPrice - soxlCostBasis) / soxlCostBasis) * 100 : 0

  // Risk Check Rules
  const riskViolations: string[] = []
  if (soxlPortfolioWeightPercent > cfg.maxPositionPercent) {
    riskViolations.push(
      `SOXL 部位佔比 (${soxlPortfolioWeightPercent.toFixed(1)}%) 超過 ${cfg.maxPositionPercent.toFixed(1)}% 最大持倉限制！`
    )
  }

  // 1. 狙擊期：本輪高點後「盤中」曾跌到啟動門檻即啟動，之後依時間陸續進場；
  //    跌得更深或站回 10 週均線並突破時，對應批次提前解鎖。
  //    SOXX 創新高 → 高點更新 → 狙擊期自動結束。
  const activated = maxDrawdown <= cfg.activateDrawdown
  const now = params.now ?? new Date()
  const weeksSince = params.sniperActivatedAt
    ? (now.getTime() - new Date(params.sniperActivatedAt).getTime()) / (7 * 24 * 3600 * 1000)
    : activated
    ? 0
    : -1
  const isHighVol =
    (params.volatility20dPercent != null && params.volatility20dPercent >= 45) ||
    (analysis.atr14wPercent != null && analysis.atr14wPercent >= 12)
  const isCautionMacro = macroVerdict === 'OVERHEAT' || macroVerdict === 'RECESSION'
  const effectiveIntervalWeeks =
    isHighVol && isCautionMacro
      ? Math.max(cfg.intervalWeeks, 8)
      : isHighVol || isCautionMacro
      ? Math.max(cfg.intervalWeeks, 6)
      : cfg.intervalWeeks
  const W = effectiveIntervalWeeks
  const unlockReason = (k: number): UnlockReason | null => {
    if (!activated) return null
    if (k === 1) return 'activation'
    if (weeksSince >= W * (k - 1)) return 'time'
    const early = cfg.earlyUnlockDrawdowns[k - 1]
    if (early !== undefined) return maxDrawdown <= early ? 'drawdown' : null
    return analysis.isAboveMa10w && analysis.isBreakout4wHigh ? 'breakout' : null
  }
  const unlockDate = (k: number) => {
    if (!params.sniperActivatedAt) return ''
    const d = new Date(new Date(params.sniperActivatedAt).getTime() + W * (k - 1) * 7 * 24 * 3600 * 1000)
    return d.toISOString().slice(0, 10)
  }
  const cond = (k: number) => {
    const base = `本輪盤中曾跌到 ${cfg.activateDrawdown}%（啟動狙擊期）`
    if (k === 1) return `${base}後即可買進`
    const timeRule = `啟動後滿 ${W * (k - 1)} 週${unlockDate(k) ? `（${unlockDate(k)} 起）` : ''}`
    const early = cfg.earlyUnlockDrawdowns[k - 1]
    if (early !== undefined) return `${timeRule}，或盤中跌到 ${early}% 提前解鎖`
    return `${timeRule}，或站回 10 週均線並突破前四週高點提前解鎖（需週線收盤確認）`
  }
  const tranches: TrancheState[] = Array.from({ length: cfg.trancheCount }, (_, i) => {
    const k = i + 1
    const initialReason = unlockReason(k)
    const timeUnlockDeferred = initialReason === 'time' && analysis.drawdownPercent > -25
    const reason = timeUnlockDeferred ? null : initialReason
    return {
      tranche: k,
      allocationPercent: cfg.tranchePercent,
      status: executedTranches.includes(k) ? 'EXECUTED' : reason ? 'CANDIDATE' : 'WAITING',
      triggerCondition: `${cond(k)}${timeUnlockDeferred ? '（目前回撤已收斂至 -25% 以內，時間解鎖暫緩）' : ''}`,
      unlockedBy: executedTranches.includes(k) ? null : reason,
    }
  })

  // 2. Evaluate Exit Tiers
  // 停利依「本次持倉週期已賣出比例」判斷是否已執行，避免賣過 1/3 後同一階梯重複出現
  const sold = params.cycleSoldQty ?? 0
  const bought = Math.max(params.cycleBoughtQty ?? 0, soxlQuantity + sold)
  const soldRatio = bought > 0 ? sold / bought : 0
  const TOL = 0.02 // 允許 2% 的零股誤差
  const sellToReach = (target: number) => Math.max(0, Math.ceil(bought * target - sold - 1e-9))
  const tiers = [...cfg.exitTiers].sort((a, b) => a.gainPercent - b.gainPercent)
  const tierReady = tiers.map(
    (t) =>
      soxlQuantity > 0 &&
      soxlCurrentReturnPercent >= t.gainPercent &&
      (t.cumulativeSellRatio >= 1 || soldRatio < t.cumulativeSellRatio - TOL)
  )
  let readyTierIdx = -1
  tierReady.forEach((r, i) => {
    if (r) readyTierIdx = i
  })
  const readyTier = readyTierIdx >= 0 ? tiers[readyTierIdx] : null
  const tierSellQty = readyTier
    ? readyTier.cumulativeSellRatio >= 1
      ? soxlQuantity
      : Math.min(soxlQuantity, sellToReach(readyTier.cumulativeSellRatio))
    : 0

  const peakPrice = Math.max(params.soxlPeakPriceSinceEntry ?? soxlPrice, soxlPrice)
  const protectionActive =
    soxlQuantity > 0 && soxlCostBasis > 0 && ((peakPrice - soxlCostBasis) / soxlCostBasis) * 100 >= 45
  const breakevenStopPrice = protectionActive ? Number((soxlCostBasis * 1.02).toFixed(2)) : null
  const trailingStopPrice = protectionActive
    ? Number((params.soxlAtr14d && params.soxlAtr14d > 0 ? peakPrice - 2.5 * params.soxlAtr14d : peakPrice * 0.85).toFixed(2))
    : null
  const effectiveStopPrice =
    breakevenStopPrice !== null && trailingStopPrice !== null
      ? Math.max(breakevenStopPrice, trailingStopPrice)
      : null
  const trailingStopWarning = effectiveStopPrice !== null && soxlPrice <= effectiveStopPrice
  const exitAlerts = {
    tier1Profit80: !!tierReady[0],
    tier2Profit150: !!tierReady[1],
    tier3Profit200: !!tierReady[2],
    ma40BreakdownWarning: analysis.isBelow40wTwoWeeks,
    timeStopWarning26w: soxlQuantity > 0 && weeksSince >= 26 && soxlCurrentReturnPercent < 15,
    trailingStopWarning,
  }

  // 建議買進股數：每批金額 ÷ 現價，且不超過距離上限的剩餘空間
  const capRoomValue = Math.max(0, (cfg.maxPositionPercent / 100) * totalPortfolioValue - soxlHoldingValue)
  const trancheValue = (cfg.tranchePercent / 100) * totalPortfolioValue
  const suggestedBuyQuantity = soxlPrice > 0 ? Math.floor(Math.min(trancheValue, capRoomValue) / soxlPrice) : 0
  const usableCashUsd = Math.max(0, cashAvailable - (params.emergencyFundAmount ?? 0) / (params.exchangeRate || 32.5))
  const cashInsufficient = totalPortfolioValue > 0 && usableCashUsd < trancheValue * 0.5

  // 3. Determine Active Signal
  let suggestedSellQuantity = 0
  let unconfirmedBlocked = false
  let activeSignal: Omit<SoxlStrategyState['activeSignal'], 'canExecuteBuy'> = {
    type: 'WAIT',
    title: '尚未進入進場觀察區',
    reason: `SOXX 目前回撤 ${analysis.drawdownPercent}%，尚未達到 ${cfg.activateDrawdown}% 第一批狙擊門檻。`,
    suggestedAction: '維持現有現金預備金儲備，不進行任何買入操作。',
    requiresHumanConfirmation: false,
    isStaleData: isStale,
  }

  if (isStale) {
    activeSignal = {
      type: 'DATA_STALE',
      title: '市場行情過期警告',
      reason: '行情 API 暫時無法獲取最新報價，目前使用本機快取歷史資料。',
      suggestedAction: '嚴禁在資料過期時產生正式交易訊號，請等待網路恢復或手動刷新。',
      requiresHumanConfirmation: false,
      isStaleData: true,
    }
  } else if (readyTier) {
    suggestedSellQuantity = tierSellQty
    const isAll = readyTier.cumulativeSellRatio >= 1
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: `第 ${readyTier.tier} 批出場訊號成立 (獲利 +${readyTier.gainPercent}%)`,
      reason: `SOXL 當前報酬率已達 ${soxlCurrentReturnPercent.toFixed(1)}% (>= +${readyTier.gainPercent}%)。`,
      suggestedAction: isAll
        ? '建議人工確認後，清空剩餘所有 SOXL 持倉鎖定利潤。'
        : readyTierIdx === 0
        ? `建議賣出約 ${tierSellQty} 股（建倉總量 ${bought} 股的 ${Math.round(readyTier.cumulativeSellRatio * 100)}%），回收部分本金。`
        : `建議賣出約 ${tierSellQty} 股，使本輪累計賣出達建倉總量（${bought} 股）的 ${Math.round(readyTier.cumulativeSellRatio * 100)}%。`,
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (exitAlerts.ma40BreakdownWarning && soxlQuantity > 0) {
    suggestedSellQuantity = soxlQuantity
    activeSignal = {
      type: 'WARNING',
      title: '結構性惡化退場警報',
      reason: `SOXX 正式週線已連續 ${cfg.stopLossMa40Weeks} 週收盤跌破 40 週均線 (40W MA)。`,
      suggestedAction: '半導體產業趨勢可能反轉，建議人工檢視並考慮退出剩餘 SOXL 部位。',
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (trailingStopWarning) {
    suggestedSellQuantity = soxlQuantity
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: 'SOXL 移動停利保護價觸發',
      reason: `SOXL 現價 $${soxlPrice.toFixed(2)} 已達保護停損價 $${effectiveStopPrice?.toFixed(2)}。`,
      suggestedAction: `建議人工確認後賣出全部 ${soxlQuantity} 股，保護已實現獲利。`,
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else {
    // Check buy tranches in order
    const readyTranche = tranches.find((t) => t.status === 'CANDIDATE')
    const overCap = soxlPortfolioWeightPercent + cfg.tranchePercent > cfg.maxPositionPercent + 0.01
    if (readyTranche && overCap) {
      activeSignal = {
        type: 'WARNING',
        title: `第 ${readyTranche.tranche} 批價格條件成立，但已接近持倉上限`,
        reason: `SOXL 目前占總資產 ${soxlPortfolioWeightPercent.toFixed(1)}%，再買 ${cfg.tranchePercent}% 會超過 ${cfg.maxPositionPercent}% 上限。`,
        suggestedAction: '不再加碼，等待停利條件。',
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (readyTranche && macroVerdict === 'STRUCTURAL') {
      activeSignal = {
        type: 'WARNING',
        title: `第 ${readyTranche.tranche} 批價格條件成立，但總經亮紅燈：先不買`,
        reason: `${readyTranche.triggerCondition}（目前回撤 ${analysis.drawdownPercent}%），但台積電營收或泡沫指標顯示產業有結構性問題。`,
        suggestedAction: '保留預備金，等台積電營收止跌或總經轉黃燈再評估。',
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (readyTranche) {
      // 狙擊期啟動、時間解鎖、跌深提前解鎖都依「盤中低點／日期」判斷，不需等週線收盤；
      // 只有「站回 10 週均線並突破前四週高點」是週線條件，最新週 K 尚未收盤時不得當正式訊號。
      const isConfirmed = readyTranche.unlockedBy !== 'breakout' || analysis.isCurrentBarConfirmed
      unconfirmedBlocked = !isConfirmed
      const recession =
        macroVerdict === 'RECESSION' || macroVerdict === 'OVERHEAT' || macroVerdict === 'UNKNOWN' || !!params.macroStale
      activeSignal = {
        type: isConfirmed && !recession && !cashInsufficient ? 'BUY_CANDIDATE' : 'MANUAL_REVIEW_REQUIRED',
        title: `第 ${readyTranche.tranche} 批可進場（狙擊期第 ${Math.floor(Math.max(0, weeksSince)) + 1} 週）`,
        reason: `${readyTranche.triggerCondition} (目前 SOXX 回撤: ${analysis.drawdownPercent}%)。${cashInsufficient ? ' 扣除緊急預備金後可用現金不足。' : ''}`,
        suggestedAction: !isConfirmed
          ? `週線突破條件為盤中暫時觸發，尚未週五正式收盤，禁止下單，請保持密切觀察。`
          : cashInsufficient
          ? `扣除緊急預備金後可用現金約 $${usableCashUsd.toFixed(2)}，不足本批建議金額的一半；請人工檢視資金來源再決定。`
          : recession
          ? `總經屬「${macroVerdict === 'RECESSION' ? '景氣衰退' : macroVerdict === 'OVERHEAT' ? '前波過熱修正' : '資料不足'}」，可投入 ${cfg.tranchePercent}%，建議確認近期止跌後再下單。`
          : `建議投入整體投資資產的 ${cfg.tranchePercent}%（約 ${suggestedBuyQuantity} 股）買進 SOXL。請點選人工確認按鈕執行。`,
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (soxlQuantity > 0) {
      activeSignal = {
        type: 'HOLD',
        title: '部位持有中，等待停利條件',
        reason: `目前持有 SOXL ${soxlQuantity} 股，平均成本 $${Number(soxlCostBasis.toFixed(4))}，未實現回報 ${soxlCurrentReturnPercent.toFixed(1)}%${sold > 0 ? `；本輪已賣出 ${sold} 股（${(soldRatio * 100).toFixed(0)}%）` : ''}。`,
        suggestedAction: `繼續耐心持有，等待獲利達 +${tiers[0]?.gainPercent ?? 80}% 第一批停利目標。`,
        requiresHumanConfirmation: false,
        isStaleData: false,
      }
    }
  }

  // 4. 6 條風控紀律：能由資料驗證的實際計算，不能驗證的明白標示「需自律」
  const unassigned = params.unassignedBuysThisCycle ?? 0
  const executedCount = new Set(executedTranches).size
  const emergency = params.emergencyFundAmount ?? 0
  const riskChecks: RiskCheck[] = [
    {
      key: 'max_position',
      rule: `SOXL 最大持倉不得超過整體投資資產 ${cfg.maxPositionPercent}%`,
      status: totalPortfolioValue <= 0 ? 'warn' : soxlPortfolioWeightPercent > cfg.maxPositionPercent ? 'fail' : 'pass',
      detail:
        totalPortfolioValue <= 0
          ? '總資產為 0，無法計算占比'
          : `目前 ${soxlPortfolioWeightPercent.toFixed(2)}% / 上限 ${cfg.maxPositionPercent}%`,
    },
    {
      key: 'no_leverage',
      rule: '禁止使用信貸、融資或合約增加部位',
      status: cashAvailable < 0 ? 'fail' : 'manual',
      detail: cashAvailable < 0 ? '預備金現金為負數，疑似借款買進' : '系統無法驗證資金來源，需自律遵守',
    },
    {
      key: 'tranche_discipline',
      rule: `禁止跌破門檻時自動攤平，嚴格依 ${cfg.trancheCount} 批進場`,
      status: unassigned > 0 || executedCount > cfg.trancheCount ? 'warn' : 'pass',
      detail:
        unassigned > 0
          ? `本輪有 ${unassigned} 筆 SOXL 買進沒有對應任何批次，請到交易帳本核對`
          : `本輪已執行 ${executedCount} / ${cfg.trancheCount} 批，皆有批次紀錄`,
    },
    {
      key: 'emergency_fund',
      rule: '緊急預備金嚴格隔離，不可動用為 SOXL 機會預備金',
      status: emergency > 0 ? 'pass' : 'warn',
      detail:
        emergency > 0
          ? `已設定緊急預備金 NT$${Math.round(emergency).toLocaleString()}，不計入投組與 SOXL 預備金`
          : '尚未在「系統設定」填寫緊急預備金金額',
    },
    {
      key: 'no_intraday_signal',
      rule: '盤中暫定訊號不得作為正式週線交易依據',
      status: activeSignal.type === 'BUY_CANDIDATE' && unconfirmedBlocked ? 'fail' : 'pass',
      detail: unconfirmedBlocked
        ? '週線突破條件尚未收盤確認，已降為「需人工判斷」'
        : analysis.isCurrentBarConfirmed
        ? '最新週 K 已收盤確認'
        : '最新週 K 尚未收盤；目前訊號不依賴週線收盤條件',
    },
    {
      key: 'human_confirmation',
      rule: '所有買賣必須有人工確認按鈕，系統禁止自動下單',
      status: 'pass',
      detail: '系統沒有自動下單功能；買賣都要在確認視窗按下確認才會寫入帳本',
    },
  ]

  return {
    config: cfg,
    currentPhase: analysis.marketPhase,
    soxxDrawdown: analysis.drawdownPercent,
    soxxPrice: analysis.currentPrice,
    soxlPrice,
    soxlCostBasis,
    soxlHoldingQuantity: soxlQuantity,
    soxlCurrentReturnPercent,
    soxlPortfolioWeightPercent,
    maxAllowedWeightPercent: cfg.maxPositionPercent,
    totalPortfolioValue,
    macroVerdict,
    cashBufferPercent,
    effectiveIntervalWeeks,
    isCurrentBarConfirmed: analysis.isCurrentBarConfirmed,
    tranches,
    suggestedBuyQuantity,
    exitTierReady: readyTier?.tier ?? null,
    suggestedSellQuantity,
    activeSignal: {
      ...activeSignal,
      canExecuteBuy:
        activeSignal.type === 'BUY_CANDIDATE' ||
        (activeSignal.type === 'MANUAL_REVIEW_REQUIRED' && !unconfirmedBlocked),
    },
    exitAlerts,
    protection: {
      active: protectionActive,
      breakevenStopPrice,
      trailingStopPrice,
      effectiveStopPrice,
    },
    riskRulesPassed: riskViolations.length === 0,
    riskViolations,
    riskChecks,
  }
}
