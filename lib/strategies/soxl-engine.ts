import { SoxxIndicatorAnalysis } from './indicators'
import { Quote } from '../market-data/provider-interface'
import type { MacroVerdict } from './macro-check'

/** 每批占總資產 %、累計上限 %（10% 預備金分 4 批） */
export const SOXL_TRANCHE_PERCENT = 2.5
export const SOXL_MAX_WEIGHT_PERCENT = 10.0

export type SignalType =
  | 'BUY_CANDIDATE'
  | 'SELL_CANDIDATE'
  | 'HOLD'
  | 'WAIT'
  | 'WARNING'
  | 'DATA_STALE'
  | 'MANUAL_REVIEW_REQUIRED'

export interface TrancheState {
  tranche: 1 | 2 | 3 | 4
  allocationPercent: number // 占總資產 %
  status: 'WAITING' | 'CANDIDATE' | 'CONFIRMED_PENDING_EXECUTION' | 'EXECUTED'
  triggerCondition: string
  executedAt?: string
  executedPrice?: number
}

export interface SoxlStrategyState {
  currentPhase: SoxxIndicatorAnalysis['marketPhase']
  soxxDrawdown: number
  soxxPrice: number
  soxlPrice: number
  soxlCostBasis: number
  soxlHoldingQuantity: number
  soxlCurrentReturnPercent: number
  soxlPortfolioWeightPercent: number
  maxAllowedWeightPercent: number
  macroVerdict: MacroVerdict
  cashBufferPercent: number
  tranches: TrancheState[]
  activeSignal: {
    type: SignalType
    title: string
    reason: string
    suggestedAction: string
    requiresHumanConfirmation: boolean
    isStaleData: boolean
  }
  exitAlerts: {
    tier1Profit80: boolean
    tier2Profit150: boolean
    tier3Profit200: boolean
    ma40BreakdownWarning: boolean
  }
  riskRulesPassed: boolean
  riskViolations: string[]
}

export function evaluateSoxlSniperStrategy(params: {
  analysis: SoxxIndicatorAnalysis
  soxlQuote: Quote
  totalPortfolioValue: number
  soxlQuantity: number
  soxlCostBasis: number
  cashAvailable: number
  executedTranches?: number[]
  /** 本輪高點以來最深的回落（%，負數），第 4 批要求曾經跌到 -40% */
  maxDrawdownSincePeak?: number
  macroVerdict?: MacroVerdict
  /** SOXX 報價或週 K 使用過期快取 */
  soxxStale?: boolean
  /** 任一總經資料使用過期快取 */
  macroStale?: boolean
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
  if (soxlPortfolioWeightPercent > SOXL_MAX_WEIGHT_PERCENT) {
    riskViolations.push(
      `SOXL 部位佔比 (${soxlPortfolioWeightPercent.toFixed(1)}%) 超過 ${SOXL_MAX_WEIGHT_PERCENT.toFixed(1)}% 最大持倉限制！`
    )
  }

  // 1. Evaluate 4 Tranches
  const tranches: TrancheState[] = [
    {
      tranche: 1,
      allocationPercent: SOXL_TRANCHE_PERCENT,
      status: executedTranches.includes(1)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -40
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -40%，並出現初步止跌訊號',
    },
    {
      tranche: 2,
      allocationPercent: SOXL_TRANCHE_PERCENT,
      status: executedTranches.includes(2)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -50
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -50%',
    },
    {
      tranche: 3,
      allocationPercent: SOXL_TRANCHE_PERCENT,
      status: executedTranches.includes(3)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -60 || (maxDrawdown <= -50 && !analysis.isNewLowWeekly && analysis.isHigherLow)
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -60%，或跌過 -50% 後週線不再創新低',
    },
    {
      tranche: 4,
      allocationPercent: SOXL_TRANCHE_PERCENT,
      status: executedTranches.includes(4)
        ? 'EXECUTED'
        : maxDrawdown <= -40 && analysis.isAboveMa10w && analysis.isBreakout4wHigh
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: '曾跌過 -40% 後，SOXX 站回 10 週均線並突破前四週最高週收盤價',
    },
  ]

  // 2. Evaluate Exit Tiers
  const exitAlerts = {
    tier1Profit80: soxlQuantity > 0 && soxlCurrentReturnPercent >= 80,
    tier2Profit150: soxlQuantity > 0 && soxlCurrentReturnPercent >= 150,
    tier3Profit200: soxlQuantity > 0 && soxlCurrentReturnPercent >= 200,
    ma40BreakdownWarning: analysis.isBelow40wTwoWeeks,
  }

  // 3. Determine Active Signal
  let activeSignal: SoxlStrategyState['activeSignal'] = {
    type: 'WAIT',
    title: '尚未進入進場觀察區',
    reason: `SOXX 目前回撤 ${analysis.drawdownPercent}%，尚未達到 -40% 第一批狙擊門檻。`,
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
  } else if (exitAlerts.tier3Profit200) {
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: '第 3 批出場訊號成立 (獲利 +200%)',
      reason: `SOXL 當前報酬率已達 ${soxlCurrentReturnPercent.toFixed(1)}% (>= +200%)。`,
      suggestedAction: '建議人工確認後，清空剩餘所有 SOXL 持倉鎖定利潤。',
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (exitAlerts.tier2Profit150) {
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: '第 2 批出場訊號成立 (獲利 +150%)',
      reason: `SOXL 當前報酬率已達 ${soxlCurrentReturnPercent.toFixed(1)}% (>= +150%)。`,
      suggestedAction: '建議賣出適當數量，使累計出場量達到原始建倉總量的 2/3。',
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (exitAlerts.tier1Profit80) {
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: '第 1 批出場訊號成立 (獲利 +80%)',
      reason: `SOXL 當前報酬率已達 ${soxlCurrentReturnPercent.toFixed(1)}% (>= +80%)。`,
      suggestedAction: '建議賣出目前 SOXL 持倉的 1/3，回收部分本金。',
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (exitAlerts.ma40BreakdownWarning && soxlQuantity > 0) {
    activeSignal = {
      type: 'WARNING',
      title: '結構性惡化退場警報',
      reason: 'SOXX 正式週線已連續 2 週收盤跌破 40 週均線 (40W MA)。',
      suggestedAction: '半導體產業趨勢可能反轉，建議人工檢視並考慮退出剩餘 SOXL 部位。',
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else {
    // Check buy tranches in order
    const readyTranche = tranches.find((t) => t.status === 'CANDIDATE')
    const overCap = soxlPortfolioWeightPercent + SOXL_TRANCHE_PERCENT > SOXL_MAX_WEIGHT_PERCENT + 0.01
    if (readyTranche && overCap) {
      // 再買一批就會超過 10% 上限
      activeSignal = {
        type: 'WARNING',
        title: `第 ${readyTranche.tranche} 批價格條件成立，但已接近持倉上限`,
        reason: `SOXL 目前占總資產 ${soxlPortfolioWeightPercent.toFixed(1)}%，再買 ${SOXL_TRANCHE_PERCENT}% 會超過 ${SOXL_MAX_WEIGHT_PERCENT}% 上限。`,
        suggestedAction: '不再加碼，等待停利條件。',
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (readyTranche && macroVerdict === 'STRUCTURAL') {
      // 價格到了，但總經判斷是產業倒退或泡沫破裂 → 不買
      activeSignal = {
        type: 'WARNING',
        title: `第 ${readyTranche.tranche} 批價格條件成立，但總經亮紅燈：先不買`,
        reason: `${readyTranche.triggerCondition}（目前回撤 ${analysis.drawdownPercent}%），但台積電營收或泡沫指標顯示產業有結構性問題。`,
        suggestedAction: '保留預備金，等台積電營收止跌或總經轉黃燈再評估。',
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (readyTranche) {
      // Check if current weekly bar is confirmed
      const isConfirmed = analysis.isCurrentBarConfirmed
      const recession =
        macroVerdict === 'RECESSION' || macroVerdict === 'OVERHEAT' || macroVerdict === 'UNKNOWN' || !!params.macroStale
      activeSignal = {
        type: isConfirmed && !recession ? 'BUY_CANDIDATE' : 'MANUAL_REVIEW_REQUIRED',
        title: `第 ${readyTranche.tranche} 批進場候選 (${isConfirmed ? '週線正式成立' : '盤中暫定觀察'})`,
        reason: `${readyTranche.triggerCondition} (目前 SOXX 回撤: ${analysis.drawdownPercent}%)。`,
        suggestedAction: !isConfirmed
          ? `盤中暫時觸發，尚未週五正式收盤，禁止自動下單，請保持密切觀察。`
          : recession
          ? `總經屬「${macroVerdict === 'RECESSION' ? '景氣衰退' : macroVerdict === 'OVERHEAT' ? '前波過熱修正' : '資料不足'}」，可投入 ${SOXL_TRANCHE_PERCENT}%，但請確認週線止跌、拉長批次間隔。`
          : `建議投入整體投資資產的 ${SOXL_TRANCHE_PERCENT}% 買進 SOXL。請點選人工確認按鈕執行。`,
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (soxlQuantity > 0) {
      activeSignal = {
        type: 'HOLD',
        title: '部位持有中，等待停利條件',
        reason: `目前持有 SOXL ${soxlQuantity} 股，平均成本 $${soxlCostBasis}，未實現回報 ${soxlCurrentReturnPercent.toFixed(1)}%。`,
        suggestedAction: '繼續耐心持有，等待獲利達 +80% 第一批停利目標。',
        requiresHumanConfirmation: false,
        isStaleData: false,
      }
    }
  }

  return {
    currentPhase: analysis.marketPhase,
    soxxDrawdown: analysis.drawdownPercent,
    soxxPrice: analysis.currentPrice,
    soxlPrice,
    soxlCostBasis,
    soxlHoldingQuantity: soxlQuantity,
    soxlCurrentReturnPercent,
    soxlPortfolioWeightPercent,
    maxAllowedWeightPercent: SOXL_MAX_WEIGHT_PERCENT,
    macroVerdict,
    cashBufferPercent,
    tranches,
    activeSignal,
    exitAlerts,
    riskRulesPassed: riskViolations.length === 0,
    riskViolations,
  }
}
