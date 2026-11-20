import { SoxxIndicatorAnalysis } from './indicators'
import { Quote } from '../market-data/provider-interface'
import type { MacroVerdict } from './macro-check'

/** 每批占總資產 %、累計上限 %（10% 預備金分 4 批） */
export const SOXL_TRANCHE_PERCENT = 2.5
export const SOXL_MAX_WEIGHT_PERCENT = 10.0
/** 盤中回落達此幅度即啟動狙擊期 */
export const SOXL_ACTIVATE_DRAWDOWN = -40
/** 啟動後每隔幾週解鎖下一批 */
export const SOXL_INTERVAL_WEEKS = 4

export type SignalType =
  | 'BUY_CANDIDATE'
  | 'SELL_CANDIDATE'
  | 'HOLD'
  | 'WAIT'
  | 'WARNING'
  | 'DATA_STALE'
  | 'MANUAL_REVIEW_REQUIRED'

export interface TrancheState {
  tranche: number
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

  // 1. 狙擊期：本輪高點後「盤中」曾跌到 -40% 即啟動，之後依時間陸續進場；
  //    跌得更深（-50% / -60%）或站回 10 週均線並突破時，對應批次提前解鎖。
  //    SOXX 創新高 → 高點更新 → 狙擊期自動結束。
  const activated = maxDrawdown <= SOXL_ACTIVATE_DRAWDOWN
  const now = params.now ?? new Date()
  const weeksSince = params.sniperActivatedAt
    ? (now.getTime() - new Date(params.sniperActivatedAt).getTime()) / (7 * 24 * 3600 * 1000)
    : activated
    ? 0
    : -1
  const W = SOXL_INTERVAL_WEEKS
  const ready = (k: 1 | 2 | 3 | 4) => {
    if (!activated) return false
    if (k === 1) return true
    if (weeksSince >= W * (k - 1)) return true
    if (k === 2) return maxDrawdown <= -50
    if (k === 3) return maxDrawdown <= -60
    return analysis.isAboveMa10w && analysis.isBreakout4wHigh
  }
  const unlockDate = (k: number) => {
    if (!params.sniperActivatedAt) return ''
    const d = new Date(new Date(params.sniperActivatedAt).getTime() + W * (k - 1) * 7 * 24 * 3600 * 1000)
    return d.toISOString().slice(0, 10)
  }
  const cond = (k: 1 | 2 | 3 | 4) => {
    const base = '本輪盤中曾跌到 -40%（啟動狙擊期）'
    if (k === 1) return `${base}後即可買進`
    const timeRule = `啟動後滿 ${W * (k - 1)} 週${unlockDate(k) ? `（${unlockDate(k)} 起）` : ''}`
    if (k === 2) return `${timeRule}，或盤中跌到 -50% 提前解鎖`
    if (k === 3) return `${timeRule}，或盤中跌到 -60% 提前解鎖`
    return `${timeRule}，或站回 10 週均線並突破前四週高點提前解鎖`
  }
  const tranches: TrancheState[] = ([1, 2, 3, 4] as const).map((k) => ({
    tranche: k,
    allocationPercent: SOXL_TRANCHE_PERCENT,
    status: executedTranches.includes(k) ? 'EXECUTED' : ready(k) ? 'CANDIDATE' : 'WAITING',
    triggerCondition: cond(k),
  }))

  // 2. Evaluate Exit Tiers
  // 停利依「本次持倉週期已賣出比例」判斷是否已執行，避免賣過 1/3 後同一階梯重複出現
  const sold = params.cycleSoldQty ?? 0
  const bought = Math.max(params.cycleBoughtQty ?? 0, soxlQuantity + sold)
  const soldRatio = bought > 0 ? sold / bought : 0
  const TOL = 0.02 // 允許 2% 的零股誤差
  const sellToReach = (target: number) => Math.max(0, Math.ceil(bought * target - sold))
  const exitAlerts = {
    tier1Profit80: soxlQuantity > 0 && soxlCurrentReturnPercent >= 80 && soldRatio < 1 / 3 - TOL,
    tier2Profit150: soxlQuantity > 0 && soxlCurrentReturnPercent >= 150 && soldRatio < 2 / 3 - TOL,
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
      suggestedAction: `建議賣出約 ${Math.min(soxlQuantity, sellToReach(2 / 3))} 股，使本輪累計賣出達建倉總量（${bought} 股）的 2/3。`,
      requiresHumanConfirmation: true,
      isStaleData: false,
    }
  } else if (exitAlerts.tier1Profit80) {
    activeSignal = {
      type: 'SELL_CANDIDATE',
      title: '第 1 批出場訊號成立 (獲利 +80%)',
      reason: `SOXL 當前報酬率已達 ${soxlCurrentReturnPercent.toFixed(1)}% (>= +80%)。`,
      suggestedAction: `建議賣出約 ${Math.min(soxlQuantity, sellToReach(1 / 3))} 股（建倉總量 ${bought} 股的 1/3），回收部分本金。`,
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
      const isConfirmed = true // 狙擊期以盤中價啟動，不需等週線收盤
      const recession =
        macroVerdict === 'RECESSION' || macroVerdict === 'OVERHEAT' || macroVerdict === 'UNKNOWN' || !!params.macroStale
      activeSignal = {
        type: isConfirmed && !recession ? 'BUY_CANDIDATE' : 'MANUAL_REVIEW_REQUIRED',
        title: `第 ${readyTranche.tranche} 批可進場（狙擊期第 ${Math.floor(Math.max(0, weeksSince)) + 1} 週）`,
        reason: `${readyTranche.triggerCondition} (目前 SOXX 回撤: ${analysis.drawdownPercent}%)。`,
        suggestedAction: !isConfirmed
          ? `盤中暫時觸發，尚未週五正式收盤，禁止自動下單，請保持密切觀察。`
          : recession
          ? `總經屬「${macroVerdict === 'RECESSION' ? '景氣衰退' : macroVerdict === 'OVERHEAT' ? '前波過熱修正' : '資料不足'}」，可投入 ${SOXL_TRANCHE_PERCENT}%，建議確認近期止跌後再下單。`
          : `建議投入整體投資資產的 ${SOXL_TRANCHE_PERCENT}% 買進 SOXL。請點選人工確認按鈕執行。`,
        requiresHumanConfirmation: true,
        isStaleData: false,
      }
    } else if (soxlQuantity > 0) {
      activeSignal = {
        type: 'HOLD',
        title: '部位持有中，等待停利條件',
        reason: `目前持有 SOXL ${soxlQuantity} 股，平均成本 $${soxlCostBasis}，未實現回報 ${soxlCurrentReturnPercent.toFixed(1)}%${sold > 0 ? `；本輪已賣出 ${sold} 股（${(soldRatio * 100).toFixed(0)}%）` : ''}。`,
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
