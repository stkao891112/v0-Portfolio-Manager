export type MarketPhase = 'BULL_EARLY' | 'BULL_MID' | 'BULL_LATE' | 'BEAR_WAITING'

export interface PhaseConfig {
  key: MarketPhase
  label: string
  description: string
  mstrRatio: number // share within crypto allocation
  btcRatio: number // share within crypto allocation
}

export const MARKET_PHASES: Record<MarketPhase, PhaseConfig> = {
  BULL_EARLY: {
    key: 'BULL_EARLY',
    label: '牛市初期',
    description: '市場剛脫離底部起漲，MSTR 高槓桿溢價空間大，重倉 MSTR (70%) 衝刺報酬',
    mstrRatio: 0.7,
    btcRatio: 0.3,
  },
  BULL_MID: {
    key: 'BULL_MID',
    label: '牛市中期',
    description: '主升段進行中，維持 MSTR 與 BTC 平衡配置 (50% / 50%)',
    mstrRatio: 0.5,
    btcRatio: 0.5,
  },
  BULL_LATE: {
    key: 'BULL_LATE',
    label: '牛市後期',
    description: '市場狂熱溢價高企，逐步收割 MSTR 利潤轉回 BTC 現貨防守 (30% / 70%)',
    mstrRatio: 0.3,
    btcRatio: 0.7,
  },
  BEAR_WAITING: {
    key: 'BEAR_WAITING',
    label: '熊市等待期',
    description: '徹底去槓桿防禦，100% BTC現貨，0% MSTR，等待下一輪週期底部',
    mstrRatio: 0.0,
    btcRatio: 1.0,
  },
}

export interface BtcMstrAnalysis {
  phase: MarketPhase
  phaseConfig: PhaseConfig
  btcPrice: number
  mstrPrice: number
  mstrBtcRatio: number
  totalCryptoBudgetUsd: number
  mstr: {
    currentQuantity: number
    currentValueUsd: number
    targetValueUsd: number
    deviationUsd: number
    suggestedAction: 'BUY' | 'SELL' | 'HOLD'
    suggestedQuantity: number
  }
  btc: {
    currentQuantity: number
    currentValueUsd: number
    targetValueUsd: number
    deviationUsd: number
    suggestedAction: 'BUY' | 'SELL' | 'HOLD'
    suggestedQuantity: number
  }
}

export function analyzeBtcMstrAllocation(
  phase: MarketPhase,
  btcPrice: number,
  mstrPrice: number,
  mstrQuantity: number,
  btcQuantity: number,
  totalPortfolioValueUsd: number
): BtcMstrAnalysis {
  const config = MARKET_PHASES[phase] || MARKET_PHASES.BULL_MID

  const mstrVal = mstrQuantity * mstrPrice
  const btcVal = btcQuantity * btcPrice
  const currentTotalCryptoVal = mstrVal + btcVal

  // Crypto allocation budget is 25% of overall portfolio
  const targetCryptoBudget = Math.max(currentTotalCryptoVal, totalPortfolioValueUsd * 0.25)

  const mstrTargetVal = targetCryptoBudget * config.mstrRatio
  const btcTargetVal = targetCryptoBudget * config.btcRatio

  const mstrDiff = mstrTargetVal - mstrVal
  const btcDiff = btcTargetVal - btcVal

  const mstrBtcRatio = btcPrice > 0 ? mstrPrice / btcPrice : 0

  return {
    phase,
    phaseConfig: config,
    btcPrice,
    mstrPrice,
    mstrBtcRatio,
    totalCryptoBudgetUsd: targetCryptoBudget,
    mstr: {
      currentQuantity: mstrQuantity,
      currentValueUsd: mstrVal,
      targetValueUsd: mstrTargetVal,
      deviationUsd: mstrDiff,
      suggestedAction: Math.abs(mstrDiff) < 100 ? 'HOLD' : mstrDiff > 0 ? 'BUY' : 'SELL',
      suggestedQuantity: mstrPrice > 0 ? Math.abs(mstrDiff) / mstrPrice : 0,
    },
    btc: {
      currentQuantity: btcQuantity,
      currentValueUsd: btcVal,
      targetValueUsd: btcTargetVal,
      deviationUsd: btcDiff,
      suggestedAction: Math.abs(btcDiff) < 100 ? 'HOLD' : btcDiff > 0 ? 'BUY' : 'SELL',
      suggestedQuantity: btcPrice > 0 ? Math.abs(btcDiff) / btcPrice : 0,
    },
  }
}
