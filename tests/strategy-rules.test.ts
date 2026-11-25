import { describe, it, expect } from 'vitest'
import {
  determineStage,
  getTargetAllocation,
  stageProgress,
  rebalanceSchedule,
  summarizeHoldings,
  planRebalanceDiff,
  evaluateStrategy,
  toSleeve,
  HoldingInput,
  AdvisorInput,
} from '../lib/strategy-rules'
import type { MarketRadarMetrics } from '../lib/market-radar'

function metrics(symbol: string, over: Partial<MarketRadarMetrics> = {}): MarketRadarMetrics {
  return {
    symbol,
    latestDate: '2026-11-20',
    latestPrice: 100,
    athPrice: 120,
    drawdownFromAthPct: -16.67,
    ma200: 95,
    distanceToMa200Pct: 5.26,
    aboveMa200: true,
    dailyRsi14: 55,
    weeklyRsi14: 60,
    lastWeeklyClose: 100,
    weeklyCloseAboveMa200: true,
    splitAdjusted: false,
    ...over,
  }
}

const calmMarket = {
  SOXX: metrics('SOXX', { aboveMa200: false, distanceToMa200Pct: -5, weeklyRsi14: 45 }),
  MSTR: metrics('MSTR', { weeklyRsi14: 50 }),
  QQQ: metrics('QQQ', { aboveMa200: false, distanceToMa200Pct: -3, weeklyRsi14: 40 }),
  'BTC-USD': metrics('BTC-USD', { aboveMa200: false, weeklyCloseAboveMa200: false, distanceToMa200Pct: -8 }),
}

/** 依 T5 標準配置建立持倉 */
function t5Holdings(total: number): HoldingInput[] {
  return [
    { symbol: 'BTC-USD', valueTwd: total * 0.2 },
    { symbol: 'MSTR', valueTwd: total * 0.1 },
    { symbol: 'SOXL', valueTwd: total * 0.15 },
    { symbol: 'QQQM', valueTwd: total * 0.25 },
    { symbol: '2330.TW', valueTwd: total * 0.2 },
    { symbol: '0052', valueTwd: total * 0.1 },
  ]
}

const baseInput = (over: Partial<AdvisorInput> = {}): AdvisorInput => ({
  holdings: t5Holdings(1_000_000),
  market: calmMarket,
  today: new Date(2026, 8, 1), // 2026-09-01，不在再平衡視窗
  aggressive: false,
  monthlyCashTwd: 20000,
  ...over,
})

const ids = (input: AdvisorInput) => evaluateStrategy(input).advices.map((a) => a.id)

describe('代碼對照', () => {
  it('合併同類代碼', () => {
    expect(toSleeve('BTC')).toBe('BTC')
    expect(toSleeve('btc-usd')).toBe('BTC')
    expect(toSleeve('2330')).toBe('2330')
    expect(toSleeve('2330.TW')).toBe('2330')
    expect(toSleeve('0052.TW')).toBe('0052')
    expect(toSleeve('QQQ')).toBe('QQQM')
    expect(toSleeve('QLD')).toBe('QQQM')
    expect(toSleeve('00662')).toBeNull()
    expect(toSleeve('CASH_TWD')).toBeNull()
  })

  it('同類代碼市值合併計算權重', () => {
    const s = summarizeHoldings(
      [
        { symbol: 'BTC', valueTwd: 100 },
        { symbol: 'BTC-USD', valueTwd: 100 },
        { symbol: '00662', valueTwd: 800 },
      ],
      getTargetAllocation(1, false)
    )
    expect(s.sleeves.BTC.valueTwd).toBe(200)
    expect(s.sleeves.BTC.weightPct).toBeCloseTo(20)
    expect(s.otherPct).toBeCloseTo(80)
  })
})

describe('資產階段（Glide Path）', () => {
  it('依總投資資產判斷階段', () => {
    expect(determineStage(0)).toBe(1)
    expect(determineStage(2_999_999)).toBe(1)
    expect(determineStage(3_000_000)).toBe(2)
    expect(determineStage(5_999_999)).toBe(2)
    expect(determineStage(6_000_000)).toBe(3)
  })

  it('各階段目標配置加總皆為 100%', () => {
    for (const [stage, agg] of [[1, false], [1, true], [2, false], [3, false]] as const) {
      const t = getTargetAllocation(stage, agg)
      expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(100)
    }
  })

  it('積極版只在階段 1 生效', () => {
    expect(getTargetAllocation(1, true).SOXL).toBe(25)
    expect(getTargetAllocation(1, true).QQQM).toBe(15)
    expect(getTargetAllocation(2, true).SOXL).toBe(10)
    expect(getTargetAllocation(2, true).SGOV).toBe(10)
    expect(getTargetAllocation(3, true).SOXL).toBe(0)
    expect(getTargetAllocation(3, true).SOXX).toBe(10)
    expect(getTargetAllocation(3, true).MSTR).toBe(0)
  })

  it('階段進度', () => {
    expect(stageProgress(1_500_000).progressPct).toBeCloseTo(50)
    expect(stageProgress(4_500_000)).toMatchObject({ stage: 2, nextThreshold: 6_000_000 })
    expect(stageProgress(4_500_000).progressPct).toBeCloseTo(50)
    expect(stageProgress(9_000_000)).toMatchObject({ stage: 3, progressPct: 100, nextThreshold: null })
  })

  it('階段 2 尚未啟用 SGOV → 橘燈提醒；配置到位 → 綠燈', () => {
    const r = evaluateStrategy(baseInput({ holdings: t5Holdings(4_000_000) }))
    expect(r.stage).toBe(2)
    expect(r.advices.find((a) => a.id === 'stage-2')?.light).toBe('orange')

    const ok: HoldingInput[] = [
      { symbol: 'BTC', valueTwd: 800_000 },
      { symbol: 'MSTR', valueTwd: 200_000 },
      { symbol: 'SOXL', valueTwd: 400_000 },
      { symbol: 'QQQM', valueTwd: 1_000_000 },
      { symbol: '2330', valueTwd: 800_000 },
      { symbol: '0052', valueTwd: 400_000 },
      { symbol: 'SGOV', valueTwd: 400_000 },
    ]
    expect(evaluateStrategy(baseInput({ holdings: ok })).advices.find((a) => a.id === 'stage-2')?.light).toBe('green')
  })

  it('階段 3 仍持有 SOXL／MSTR → 橘燈提醒轉 SOXX 與 BTC', () => {
    const r = evaluateStrategy(baseInput({ holdings: t5Holdings(7_000_000) }))
    expect(r.stage).toBe(3)
    const a = r.advices.find((x) => x.id === 'stage-3')!
    expect(a.light).toBe('orange')
    expect(a.title).toContain('SOXX')
  })

  it('尚未建倉也能運作', () => {
    const r = evaluateStrategy(baseInput({ holdings: [] }))
    expect(r.stage).toBe(1)
    expect(r.summary.totalTwd).toBe(0)
    expect(r.advices.some((a) => a.id === 'stage-empty')).toBe(true)
    expect(r.advices.some((a) => a.category === 'fuse')).toBe(false)
    expect(r.overall).toBe('green')
  })
})

describe('半年再平衡倒數（6/15、12/15）', () => {
  it('計算下一次再平衡日與天數', () => {
    expect(rebalanceSchedule(new Date(2026, 0, 1))).toMatchObject({ nextDate: '2026-06-15', inWindow: false })
    expect(rebalanceSchedule(new Date(2026, 5, 14)).daysUntilNext).toBe(1)
    expect(rebalanceSchedule(new Date(2026, 10, 25))).toMatchObject({ nextDate: '2026-12-15', daysUntilNext: 20 })
    expect(rebalanceSchedule(new Date(2026, 11, 20))).toMatchObject({ nextDate: '2027-06-15' })
  })

  it('前後 7 天視窗（含邊界）', () => {
    expect(rebalanceSchedule(new Date(2026, 5, 8)).inWindow).toBe(true) // 6/8：前 7 天
    expect(rebalanceSchedule(new Date(2026, 5, 7)).inWindow).toBe(false) // 6/7：前 8 天
    expect(rebalanceSchedule(new Date(2026, 5, 15))).toMatchObject({ inWindow: true, offsetFromNearest: 0 })
    expect(rebalanceSchedule(new Date(2026, 5, 22))).toMatchObject({ inWindow: true, offsetFromNearest: 7 })
    expect(rebalanceSchedule(new Date(2026, 5, 23)).inWindow).toBe(false)
    expect(rebalanceSchedule(new Date(2026, 11, 10)).inWindow).toBe(true)
    expect(rebalanceSchedule(new Date(2027, 0, 1)).inWindow).toBe(false)
  })

  it('視窗外顯示綠燈倒數；視窗內亮橘燈並算出差額', () => {
    const out = evaluateStrategy(baseInput())
    expect(out.advices.find((a) => a.id === 'rebalance-countdown')?.light).toBe('green')
    expect(out.rebalancePlan).toBeNull()

    const holdings: HoldingInput[] = [
      { symbol: 'BTC', valueTwd: 300_000 }, // 30%（目標 20%）超標
      { symbol: 'MSTR', valueTwd: 100_000 },
      { symbol: 'SOXL', valueTwd: 50_000 }, // 5%（目標 15%）低配
      { symbol: 'QQQM', valueTwd: 250_000 },
      { symbol: '2330', valueTwd: 200_000 },
      { symbol: '0052', valueTwd: 100_000 },
    ]
    const r = evaluateStrategy(baseInput({ holdings, today: new Date(2026, 11, 12), monthlyCashTwd: 20_000 }))
    expect(r.advices.find((a) => a.id === 'rebalance-window')?.light).toBe('orange')
    const plan = r.rebalancePlan!
    expect(plan.totalGapTwd).toBeCloseTo(100_000)
    expect(plan.cashCoversGap).toBe(false)
    const soxl = plan.rows.find((x) => x.sleeve === 'SOXL')!
    expect(soxl.diffTwd).toBeCloseTo(100_000)
    expect(soxl.buyWithCashTwd).toBeCloseTo(20_000)
    expect(plan.rows.find((x) => x.sleeve === 'BTC')!.sellTwd).toBeCloseTo(80_000)
  })

  it('新資金足夠時不需賣出', () => {
    const s = summarizeHoldings(
      [
        { symbol: 'BTC', valueTwd: 250 },
        { symbol: '2330', valueTwd: 750 },
      ],
      getTargetAllocation(1, false)
    )
    const plan = planRebalanceDiff(s, 10_000)
    expect(plan.cashCoversGap).toBe(true)
    expect(plan.totalSellTwd).toBe(0)
  })
})

describe('2 倍暴衝保險絲', () => {
  it('權重未達門檻不觸發', () => {
    expect(ids(baseInput()).some((id) => id.startsWith('fuse-'))).toBe(false)
  })

  it('SOXL ≥ 30% 觸發紅燈，修剪至目標 15%', () => {
    const holdings: HoldingInput[] = [
      { symbol: 'SOXL', valueTwd: 300_000 },
      { symbol: 'QQQM', valueTwd: 700_000 },
    ]
    const r = evaluateStrategy(baseInput({ holdings }))
    const fuse = r.advices.find((a) => a.id === 'fuse-SOXL')!
    expect(fuse.light).toBe('red')
    expect(fuse.amountTwd).toBeCloseTo(150_000)
    expect(fuse.detail).toContain('SOXX')
    expect(r.overall).toBe('red')
    expect(r.advices[0].light).toBe('red') // 紅燈排最前面
  })

  it('MSTR ≥ 20% 修剪超過 10% 的部分；BTC ≥ 35% 修剪超過 20% 的部分', () => {
    const holdings: HoldingInput[] = [
      { symbol: 'MSTR', valueTwd: 200_000 },
      { symbol: 'BTC-USD', valueTwd: 200_000 },
      { symbol: 'BTC', valueTwd: 150_000 }, // 合併後 BTC 35%
      { symbol: 'QQQM', valueTwd: 450_000 },
    ]
    const r = evaluateStrategy(baseInput({ holdings }))
    expect(r.advices.find((a) => a.id === 'fuse-MSTR')?.amountTwd).toBeCloseTo(100_000)
    expect(r.advices.find((a) => a.id === 'fuse-BTC')?.amountTwd).toBeCloseTo(150_000)
  })

  it('19.9% 的 MSTR 不觸發', () => {
    const holdings: HoldingInput[] = [
      { symbol: 'MSTR', valueTwd: 199 },
      { symbol: 'QQQM', valueTwd: 801 },
    ]
    expect(ids(baseInput({ holdings }))).not.toContain('fuse-MSTR')
  })
})

describe('市場位階：SOXL／MSTR 過熱轉回原型', () => {
  it('SOXX 週 RSI > 75 → 新資金停買 SOXL', () => {
    const market = { ...calmMarket, SOXX: metrics('SOXX', { weeklyRsi14: 78 }) }
    const r = evaluateStrategy(baseInput({ market }))
    const a = r.advices.find((x) => x.id === 'soxx-overheat')!
    expect(a.light).toBe('orange')
    expect(a.detail).toContain('70')
  })

  it('SOXX 週 RSI 72 → 緩衝區提示，不亮橘燈', () => {
    const market = { ...calmMarket, SOXX: metrics('SOXX', { weeklyRsi14: 72, aboveMa200: false }) }
    const r = evaluateStrategy(baseInput({ market }))
    expect(r.advices.find((x) => x.id === 'soxx-cooling')?.light).toBe('info')
    expect(r.overall).toBe('green')
  })

  it('積極版 + SOXX 站回 200MA → 提示 SOXL 降回 15%', () => {
    const market = { ...calmMarket, SOXX: metrics('SOXX', { aboveMa200: true, weeklyRsi14: 55 }) }
    expect(ids(baseInput({ market, aggressive: true }))).toContain('soxl-aggressive-exit')
    expect(ids(baseInput({ market, aggressive: false }))).not.toContain('soxl-aggressive-exit')
    // SOXX 仍在 200MA 下方 → 積極版繼續
    expect(ids(baseInput({ aggressive: true }))).not.toContain('soxl-aggressive-exit')
  })

  it('MSTR 週 RSI > 75 → 改投 BTC／SGOV，並提醒人工確認 mNAV', () => {
    const market = { ...calmMarket, MSTR: metrics('MSTR', { weeklyRsi14: 80 }) }
    const a = evaluateStrategy(baseInput({ market })).advices.find((x) => x.id === 'mstr-overheat')!
    expect(a.light).toBe('orange')
    expect(a.detail).toContain('mNAV')
    expect(a.detail).toContain('-50%')
  })

  it('MSTR 距高點跌破 -50% → 熊市重啟', () => {
    const market = { ...calmMarket, MSTR: metrics('MSTR', { weeklyRsi14: 30, drawdownFromAthPct: -55 }) }
    expect(ids(baseInput({ market }))).toContain('mstr-bear-restart')
  })

  it('階段 3 MSTR 目標歸零 → 不再提示 MSTR 過熱', () => {
    const market = { ...calmMarket, MSTR: metrics('MSTR', { weeklyRsi14: 80 }) }
    expect(ids(baseInput({ market, holdings: t5Holdings(7_000_000) }))).not.toContain('mstr-overheat')
  })
})

describe('選配開關：QLD 與 BTC 1.5x', () => {
  it('QQQ 在 200MA 下方 → 維持 QQQM', () => {
    expect(ids(baseInput())).toContain('qld-hold')
  })

  it('QQQ 站上 200MA 且週 RSI 50～70 → 可選配 QLD', () => {
    const market = { ...calmMarket, QQQ: metrics('QQQ', { aboveMa200: true, weeklyRsi14: 65 }) }
    expect(ids(baseInput({ market }))).toContain('qld-option')
    const hot = { ...calmMarket, QQQ: metrics('QQQ', { aboveMa200: true, weeklyRsi14: 74 }) }
    expect(ids(baseInput({ market: hot }))).toContain('qld-wait')
  })

  it('BTC 在 200MA 下方 → 維持 100% 現貨不開借貸', () => {
    const a = evaluateStrategy(baseInput()).advices.find((x) => x.id === 'btc-spot-only')!
    expect(a.light).toBe('green')
    expect(a.title).toContain('不開借貸')
  })

  it('BTC 日線站上但週收盤未確認 → 仍維持現貨', () => {
    const market = { ...calmMarket, 'BTC-USD': metrics('BTC-USD', { aboveMa200: true, weeklyCloseAboveMa200: false }) }
    const a = evaluateStrategy(baseInput({ market })).advices.find((x) => x.id === 'btc-spot-only')!
    expect(a.title).toContain('週收盤尚未確認')
  })

  it('BTC 週收盤站上 200MA → 可選配 1.5x 半倉（LTV 40%）', () => {
    const market = { ...calmMarket, 'BTC-USD': metrics('BTC-USD', { aboveMa200: true, weeklyCloseAboveMa200: true }) }
    const a = evaluateStrategy(baseInput({ market })).advices.find((x) => x.id === 'btc-leverage-option')!
    expect(a.light).toBe('info')
    expect(a.detail).toContain('40%')
  })

  it('行情缺漏時優雅降級', () => {
    const r = evaluateStrategy(baseInput({ market: {} }))
    expect(r.advices.filter((a) => a.light === 'unknown').map((a) => a.id)).toEqual(
      expect.arrayContaining(['soxx-missing', 'mstr-missing', 'btc-missing'])
    )
  })
})

describe('今日行動總結', () => {
  it('平靜市場 + 配置到位 → 綠燈', () => {
    const r = evaluateStrategy(baseInput())
    expect(r.overall).toBe('green')
    expect(r.headline).toContain('照常執行每月定投')
  })
})
