/**
 * 交易帳本的持倉計算（移動平均成本法），交易 API 與 SOXL 下單 API 共用。
 *
 * - BUY / INITIAL_BALANCE：數量增加，平均成本 =（原成本總額 + 本次金額 + 手續費）÷ 新數量
 * - SELL：數量減少、平均成本不變；已實現損益 =（賣價 − 平均成本）× 數量 − 手續費
 *         賣出數量超過持有量 → 拋出 LedgerError（API 回 400，不再偷偷改成 0）
 * - DIVIDEND：持倉不變；已實現損益 = 股數 × 每股股息 − 手續費
 */

export type TradeType = 'BUY' | 'SELL' | 'DIVIDEND' | 'INITIAL_BALANCE'
export const TRADE_TYPES: TradeType[] = ['BUY', 'SELL', 'DIVIDEND', 'INITIAL_BALANCE']

export interface Position {
  quantity: number
  costPerUnit: number
}

export interface Trade {
  type: TradeType
  quantity: number
  price: number
  fee?: number
}

export interface TradeResult {
  position: Position
  realizedPnl: number | null
}

export class LedgerError extends Error {
  constructor(message: string, public code: 'INVALID' | 'OVERSELL' | 'UNREVERSIBLE') {
    super(message)
    this.name = 'LedgerError'
  }
}

/** 浮點誤差容許值（例如 0.1 + 0.2） */
const EPS = 1e-9

export function validateTrade(t: Partial<Trade>): asserts t is Trade {
  if (!t.type || !TRADE_TYPES.includes(t.type)) throw new LedgerError('交易類型不正確', 'INVALID')
  if (!(typeof t.quantity === 'number' && Number.isFinite(t.quantity) && t.quantity > 0))
    throw new LedgerError('數量必須大於 0', 'INVALID')
  if (!(typeof t.price === 'number' && Number.isFinite(t.price) && t.price > 0))
    throw new LedgerError('價格必須大於 0', 'INVALID')
  const fee = t.fee ?? 0
  if (!(typeof fee === 'number' && Number.isFinite(fee) && fee >= 0)) throw new LedgerError('手續費不可為負數', 'INVALID')
}

export function applyTrade(position: Position, trade: Trade): TradeResult {
  validateTrade(trade)
  const fee = trade.fee ?? 0
  const qty = Number(position.quantity) || 0
  const cost = Number(position.costPerUnit) || 0

  switch (trade.type) {
    case 'BUY':
    case 'INITIAL_BALANCE': {
      const newQty = qty + trade.quantity
      const newCost = (qty * cost + trade.quantity * trade.price + fee) / newQty
      return { position: { quantity: newQty, costPerUnit: newCost }, realizedPnl: null }
    }
    case 'SELL': {
      if (trade.quantity > qty + EPS) {
        throw new LedgerError(`賣出數量 ${trade.quantity} 超過目前持有量 ${qty}`, 'OVERSELL')
      }
      const remaining = Math.abs(qty - trade.quantity) < EPS ? 0 : qty - trade.quantity
      const realizedPnl = (trade.price - cost) * trade.quantity - fee
      return { position: { quantity: remaining, costPerUnit: cost }, realizedPnl }
    }
    case 'DIVIDEND':
      return { position: { quantity: qty, costPerUnit: cost }, realizedPnl: trade.quantity * trade.price - fee }
  }
}

/**
 * 刪除（沖銷）一筆交易時回沖持倉。
 * 只回沖這一筆：若之後還有其他交易，平均成本會是近似值（API 會提示使用者核對）。
 */
export function reverseTrade(position: Position, trade: Trade): Position {
  const fee = trade.fee ?? 0
  const qty = Number(position.quantity) || 0
  const cost = Number(position.costPerUnit) || 0
  switch (trade.type) {
    case 'BUY':
    case 'INITIAL_BALANCE': {
      const newQty = qty - trade.quantity
      if (newQty < -EPS) {
        throw new LedgerError(`目前持有 ${qty}，不足以回沖這筆 ${trade.quantity} 的買進（之後可能已賣出）`, 'UNREVERSIBLE')
      }
      if (newQty <= EPS) return { quantity: 0, costPerUnit: 0 }
      const newCost = (qty * cost - (trade.quantity * trade.price + fee)) / newQty
      return { quantity: newQty, costPerUnit: newCost > 0 ? newCost : cost }
    }
    case 'SELL':
      return { quantity: qty + trade.quantity, costPerUnit: cost }
    case 'DIVIDEND':
      return { quantity: qty, costPerUnit: cost }
  }
}
