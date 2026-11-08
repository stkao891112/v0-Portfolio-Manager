import { SoxxIndicatorAnalysis } from './indicators'
import { Quote } from '../market-data/provider-interface'

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
  allocationPercent: 1.25 // 1.25% of total portfolio
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
  maxAllowedWeightPercent: 5.0
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
}): SoxlStrategyState {
  const { analysis, soxlQuote, totalPortfolioValue, soxlQuantity, soxlCostBasis, cashAvailable, executedTranches = [] } = params

  const soxlPrice = soxlQuote.price
  const isStale = soxlQuote.isStale
  const soxlHoldingValue = soxlQuantity * soxlPrice
  const soxlPortfolioWeightPercent =
    totalPortfolioValue > 0 ? (soxlHoldingValue / totalPortfolioValue) * 100 : 0
  const cashBufferPercent = totalPortfolioValue > 0 ? (cashAvailable / totalPortfolioValue) * 100 : 0

  const soxlCurrentReturnPercent =
    soxlCostBasis > 0 && soxlQuantity > 0 ? ((soxlPrice - soxlCostBasis) / soxlCostBasis) * 100 : 0

  // Risk Check Rules
  const riskViolations: string[] = []
  if (soxlPortfolioWeightPercent > 5.0) {
    riskViolations.push(`SOXL 部位佔比 (${soxlPortfolioWeightPercent.toFixed(1)}%) 超過 5.0% 最大持倉限制！`)
  }

  // 1. Evaluate 4 Tranches
  const tranches: TrancheState[] = [
    {
      tranche: 1,
      allocationPercent: 1.25,
      status: executedTranches.includes(1)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -40
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -40%，並出現初步止跌訊號',
    },
    {
      tranche: 2,
      allocationPercent: 1.25,
      status: executedTranches.includes(2)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -45
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -45%，再次測試低點且未有效跌破',
    },
    {
      tranche: 3,
      allocationPercent: 1.25,
      status: executedTranches.includes(3)
        ? 'EXECUTED'
        : analysis.drawdownPercent <= -50 && !analysis.isNewLowWeekly
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 回撤達 -50%，且不再創週線收盤新低',
    },
    {
      tranche: 4,
      allocationPercent: 1.25,
      status: executedTranches.includes(4)
        ? 'EXECUTED'
        : analysis.isAboveMa10w && analysis.isBreakout4wHigh
        ? 'CANDIDATE'
        : 'WAITING',
      triggerCondition: 'SOXX 站回 10 週均線，並突破前四週最高週收盤價',
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
  } else if (exitAlerts.ma40BreakdownWarning) {
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
    if (readyTranche) {
      // Check if current weekly bar is confirmed
      const isConfirmed = analysis.isCurrentBarConfirmed
      activeSignal = {
        type: isConfirmed ? 'BUY_CANDIDATE' : 'MANUAL_REVIEW_REQUIRED',
        title: `第 ${readyTranche.tranche} 批進場候選 (${isConfirmed ? '週線正式成立' : '盤中暫定觀察'})`,
        reason: `${readyTranche.triggerCondition} (目前 SOXX 回撤: ${analysis.drawdownPercent}%)。`,
        suggestedAction: isConfirmed
          ? `建議投入整體投資資產的 1.25% 買進 SOXL。請點選人工確認按鈕執行。`
          : `盤中暫時觸發，尚未週五正式收盤，禁止自動下單，請保持密切觀察。`,
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
    maxAllowedWeightPercent: 5.0,
    cashBufferPercent,
    tranches,
    activeSignal,
    exitAlerts,
    riskRulesPassed: riskViolations.length === 0,
    riskViolations,
  }
}
