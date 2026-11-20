import { describe, it, expect } from 'vitest'
import { runSoxlBacktest } from '../lib/strategies/backtest'
import { DEFAULT_SOXL_CONFIG } from '../lib/strategies/config'
import { PriceBar } from '../lib/market-data/provider-interface'

const WEEK = 7 * 24 * 3600 * 1000
const base = new Date('2022-01-03T00:00:00Z').getTime()

/** 依收盤價陣列產生週 K（low = close，方便精準控制回撤） */
function bars(closes: number[], opts: { skip?: number[] } = {}): PriceBar[] {
  return closes
    .map((c, i) => ({
      timestamp: new Date(base + i * WEEK).toISOString(),
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1000,
      isClosed: true,
    }))
    .filter((_, i) => !(opts.skip ?? []).includes(i))
}

const SLIP = 0.001
const FEE = 0.001

describe('Historical Backtest Simulation Tests', () => {
  it('should run backtest simulation and return performance statistics', () => {
    const soxxBars: PriceBar[] = []
    const soxlBars: PriceBar[] = []
    // Scenario: SOXX drops from 300 to 160 (-46.6%) then rebounds to 260
    for (let i = 0; i < 60; i++) {
      const d = new Date(base + i * WEEK).toISOString()
      const soxxPrice = i < 30 ? 300 - i * 4.6 : 160 + (i - 30) * 3.3
      const soxlPrice = i < 30 ? Math.max(5, 50 - i * 1.4) : 8 + (i - 30) * 1.0
      soxxBars.push({ timestamp: d, open: soxxPrice, high: soxxPrice + 2, low: soxxPrice - 2, close: soxxPrice, volume: 1, isClosed: true })
      soxlBars.push({ timestamp: d, open: soxlPrice, high: soxlPrice + 1, low: soxlPrice - 1, close: soxlPrice, volume: 1, isClosed: true })
    }

    const result = runSoxlBacktest({ soxxBars, soxlBars, scenarioName: '測試模擬環境' })

    expect(result.initialCapital).toBe(10000)
    expect(result.finalEquity).toBeGreaterThan(0)
    expect(result.trades.length).toBeGreaterThan(0)
    expect(result.trades[0].type).toBe('BUY')
    expect(result.trades[0].reason).toContain('第 1 批進場')
    expect(result.equityCurve.length).toBe(60)
    // 參數與實盤同一來源：10% = 2.5% × 4
    expect(result.config.maxPositionPercent).toBe(10)
    expect(result.config.tranchePercent).toBe(2.5)
    // 四批全部進場後 SOXL 不會超過 10%（容許價格波動造成的些微超出不會再加碼）
    const buys = result.trades.filter((t) => t.type === 'BUY')
    expect(new Set(buys.map((t) => t.tranche)).size).toBe(buys.length)
    expect(buys.length).toBeLessThanOrEqual(4)
  })

  // 兩輪情境：第 2 週跌 -42% 啟動 → 第 3 週 SOXL +200% 全數停利、SOXX 創新高 → 第 4 週再跌 -45% → 第 5 週 +80% 停利
  const soxx = [100, 100, 58, 110, 60, 70]
  const soxl = [50, 50, 10, 31, 10, 18.5]

  it('買賣滑價方向分開：買進較高、賣出較低；淨值用市價不含滑價', () => {
    const r = runSoxlBacktest({ soxxBars: bars(soxx), soxlBars: bars(soxl) })
    const firstBuy = r.trades.find((t) => t.type === 'BUY')!
    const firstSell = r.trades.find((t) => t.type === 'SELL')!
    expect(firstBuy.price).toBeCloseTo(10 * (1 + SLIP), 10)
    expect(firstSell.price).toBeCloseTo(31 * (1 - SLIP), 10)

    // 第 2 週（買進當週）淨值 = 現金 + 股數 × 收盤價 10（不是 10.01）
    const cashAfterBuy = 10000 - firstBuy.quantity * firstBuy.price - firstBuy.fee
    expect(r.equityCurve[2].equity).toBeCloseTo(cashAfterBuy + firstBuy.quantity * 10, 2)
  })

  it('零股不會讓現金蒸發：只扣實際成交金額＋手續費，現金流完全對得起來', () => {
    const r = runSoxlBacktest({ soxxBars: bars(soxx), soxlBars: bars(soxl) })
    const firstBuy = r.trades[0]
    // 2.5% × 10000 = 250 → floor(250 / (10.01 × 1.001)) = 24 股，實付 24 × 10.01 + 手續費，剩下的零頭留在現金
    expect(firstBuy.quantity).toBe(24)
    expect(firstBuy.fee).toBeCloseTo(24 * 10.01 * FEE, 10)

    let cash = 10000
    let units = 0
    for (const t of r.trades) {
      if (t.type === 'BUY') {
        cash -= t.quantity * t.price + t.fee
        units += t.quantity
      } else {
        cash += t.quantity * t.price - t.fee
        units -= t.quantity
      }
    }
    const lastClose = soxl[soxl.length - 1]
    expect(r.finalEquity).toBeCloseTo(cash + units * lastClose, 1)
  })

  it('清倉後第二輪：本輪建倉量與停利階梯重置（第 1 批停利只賣第二輪建倉量的 1/3）', () => {
    const r = runSoxlBacktest({ soxxBars: bars(soxx), soxlBars: bars(soxl) })
    const buys = r.trades.filter((t) => t.type === 'BUY')
    expect(buys.map((t) => t.tranche)).toEqual([1, 1]) // 兩輪都從第 1 批開始

    // 第一輪：+200% 當週三個階梯依序執行，全部清空
    const round1Sells = r.trades.filter((t) => t.type === 'SELL' && t.date === r.equityCurve[3].date)
    expect(round1Sells.map((t) => t.exitTier)).toEqual([1, 2, 3])
    expect(round1Sells.reduce((a, t) => a + t.quantity, 0)).toBe(buys[0].quantity)

    // 第二輪：第 1 批停利 = ceil(第二輪建倉量 / 3)，不是兩輪累加
    const round2Sell = r.trades.filter((t) => t.type === 'SELL' && t.date === r.equityCurve[5].date)
    expect(round2Sell.length).toBe(1)
    expect(round2Sell[0].exitTier).toBe(1)
    expect(round2Sell[0].quantity).toBe(Math.ceil(buys[1].quantity / 3))

    // 持有週數以真實持倉計：第一輪 1 週、第二輪到回測結束 1 週
    expect(r.avgHoldingWeeks).toBe(1)
    expect(r.winRate).toBe(100)
    expect(r.maxSingleLossPercent).toBe(0)
  })

  it('建倉少於 3 股也能執行第 1 批停利（不會卡死）', () => {
    // 2000 × 2.5% = 50 → 50 / 20.02 → 2 股
    const r = runSoxlBacktest({
      soxxBars: bars([100, 58, 60]),
      soxlBars: bars([40, 20, 37]), // +85%
      config: { initialCapital: 2000 },
    })
    const buy = r.trades.find((t) => t.type === 'BUY')!
    expect(buy.quantity).toBe(2)
    const sell = r.trades.find((t) => t.type === 'SELL')
    expect(sell).toBeDefined()
    expect(sell!.quantity).toBe(1)
    expect(sell!.exitTier).toBe(1)
  })

  it('日期對不上的週直接略過，不再用陣列索引配到別週價格', () => {
    const r = runSoxlBacktest({
      soxxBars: bars([100, 100, 58, 60, 62]),
      soxlBars: bars([50, 50, 10, 11, 12], { skip: [2] }), // 缺了 SOXX 跌到 -42% 那一週的 SOXL
    })
    expect(r.skippedWeeks).toBe(1)
    expect(r.equityCurve.length).toBe(4)
    expect(r.equityCurve.map((e) => e.date)).not.toContain(bars([0, 0, 0])[2].timestamp.slice(0, 10))
    // 下一週（SOXL 有資料）才進場，成交價用該週的 11，而不是錯位的別週價格
    expect(r.trades[0].price).toBeCloseTo(11 * (1 + SLIP), 10)
  })

  it('沒有任何賣單時勝率為 null（不假給 100%）', () => {
    const r = runSoxlBacktest({ soxxBars: bars([100, 58, 59]), soxlBars: bars([50, 10, 10.5]) })
    expect(r.trades.some((t) => t.type === 'SELL')).toBe(false)
    expect(r.winRate).toBeNull()
  })

  it('預設參數與 config.ts 一致', () => {
    const r = runSoxlBacktest({ soxxBars: bars([100]), soxlBars: bars([50]) })
    expect(r.config).toEqual({ ...DEFAULT_SOXL_CONFIG })
  })
})
