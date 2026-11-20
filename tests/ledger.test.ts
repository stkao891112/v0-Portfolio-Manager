import { describe, it, expect } from 'vitest'
import { applyTrade, reverseTrade, LedgerError } from '../lib/ledger'

describe('交易帳本：移動平均成本、已實現損益、超賣攔截', () => {
  it('買進：數量增加、平均成本含手續費', () => {
    const r = applyTrade({ quantity: 100, costPerUnit: 10 }, { type: 'BUY', quantity: 100, price: 20, fee: 10 })
    expect(r.position.quantity).toBe(200)
    expect(r.position.costPerUnit).toBeCloseTo((1000 + 2000 + 10) / 200, 10)
    expect(r.realizedPnl).toBeNull()
  })

  it('賣出：平均成本不變、已實現損益 =（賣價 − 成本）× 數量 − 手續費', () => {
    const r = applyTrade({ quantity: 200, costPerUnit: 15 }, { type: 'SELL', quantity: 50, price: 21, fee: 5 })
    expect(r.position.quantity).toBe(150)
    expect(r.position.costPerUnit).toBe(15)
    expect(r.realizedPnl).toBeCloseTo((21 - 15) * 50 - 5, 10)
  })

  it('賣出虧損時已實現損益為負', () => {
    const r = applyTrade({ quantity: 10, costPerUnit: 100 }, { type: 'SELL', quantity: 10, price: 80 })
    expect(r.realizedPnl).toBe(-200)
    expect(r.position.quantity).toBe(0)
  })

  it('超賣直接拋錯（不再靜默改成 0）', () => {
    expect(() => applyTrade({ quantity: 10, costPerUnit: 5 }, { type: 'SELL', quantity: 11, price: 6 })).toThrow(LedgerError)
    try {
      applyTrade({ quantity: 10, costPerUnit: 5 }, { type: 'SELL', quantity: 11, price: 6 })
    } catch (e: any) {
      expect(e.code).toBe('OVERSELL')
    }
  })

  it('浮點誤差內的全數賣出可以通過', () => {
    const r = applyTrade({ quantity: 0.1 + 0.2, costPerUnit: 1 }, { type: 'SELL', quantity: 0.3, price: 2 })
    expect(r.position.quantity).toBe(0)
  })

  it('數量、價格必須 > 0；手續費不可為負', () => {
    const pos = { quantity: 10, costPerUnit: 5 }
    expect(() => applyTrade(pos, { type: 'BUY', quantity: 0, price: 5 })).toThrow('數量必須大於 0')
    expect(() => applyTrade(pos, { type: 'BUY', quantity: -1, price: 5 })).toThrow('數量必須大於 0')
    expect(() => applyTrade(pos, { type: 'BUY', quantity: 1, price: 0 })).toThrow('價格必須大於 0')
    expect(() => applyTrade(pos, { type: 'BUY', quantity: 1, price: 5, fee: -1 })).toThrow('手續費不可為負數')
  })

  it('股息：持倉不變，已實現損益 = 股數 × 每股股息 − 手續費', () => {
    const r = applyTrade({ quantity: 1000, costPerUnit: 50 }, { type: 'DIVIDEND', quantity: 1000, price: 2.5, fee: 10 })
    expect(r.position).toEqual({ quantity: 1000, costPerUnit: 50 })
    expect(r.realizedPnl).toBe(2490)
  })

  it('刪除（沖銷）交易：買進回沖可還原原本持倉；賣出回沖加回數量', () => {
    const start = { quantity: 100, costPerUnit: 10 }
    const buy = { type: 'BUY' as const, quantity: 50, price: 16, fee: 2 }
    const after = applyTrade(start, buy).position
    const back = reverseTrade(after, buy)
    expect(back.quantity).toBeCloseTo(100, 10)
    expect(back.costPerUnit).toBeCloseTo(10, 10)

    expect(reverseTrade({ quantity: 70, costPerUnit: 10 }, { type: 'SELL', quantity: 30, price: 12 })).toEqual({
      quantity: 100,
      costPerUnit: 10,
    })
    expect(() => reverseTrade({ quantity: 10, costPerUnit: 1 }, { type: 'BUY', quantity: 20, price: 1 })).toThrow(LedgerError)
  })
})
