/**
 * 個人投資規則自動判定引擎（純函式，前後端與測試共用）
 *
 * 輸入：市場位階（/api/strategy-radar）＋ 真實持倉市值（TWD）＋ 今天日期 ＋ 積極版開關
 * 輸出：資產階段、目標配置、半年再平衡倒數、行動建議清單（綠／橘／紅燈）
 *
 * 權重分母 = 全部持倉市值（TWD，含現金與規則外標的），與「總投資資產」一致。
 */

import type { MarketRadarMetrics } from './market-radar'

export type Light = 'green' | 'orange' | 'red' | 'info' | 'unknown'

/** 規則內的標的槽位 */
export type Sleeve = 'BTC' | 'MSTR' | 'SOXL' | 'SOXX' | 'QQQM' | '2330' | '0052' | 'SGOV'

export const SLEEVES: Sleeve[] = ['BTC', 'MSTR', 'SOXL', 'SOXX', 'QQQM', '2330', '0052', 'SGOV']

export type TargetAllocation = Record<Sleeve, number>

/** 代碼對照：合併同類代碼（BTC / BTC-USD、2330 / 2330.TW、QQQ / QQQM / QLD 同屬那斯達克 100 槽位） */
const SLEEVE_ALIASES: Record<string, Sleeve> = {
  BTC: 'BTC',
  MSTR: 'MSTR',
  SOXL: 'SOXL',
  SOXX: 'SOXX',
  QQQM: 'QQQM',
  QQQ: 'QQQM',
  QLD: 'QQQM',
  '2330': '2330',
  '0052': '0052',
  SGOV: 'SGOV',
}

/** 把任何輸入代碼轉成規則槽位；不屬於規則標的回傳 null */
export function toSleeve(symbol: string | null | undefined): Sleeve | null {
  if (!symbol) return null
  const base = symbol
    .trim()
    .toUpperCase()
    .replace(/\.TWO?$/, '')
    .replace(/-USD$/, '')
  return SLEEVE_ALIASES[base] ?? null
}

export const STAGE_THRESHOLDS = { stage2: 3_000_000, stage3: 6_000_000 }

export type Stage = 1 | 2 | 3

export const STAGE_INFO: Record<Stage, { name: string; range: string }> = {
  1: { name: '衝刺期', range: '0 ～ 300 萬' },
  2: { name: '成長期', range: '300 ～ 600 萬' },
  3: { name: '守成衝刺期', range: '≥ 600 萬' },
}

const T5_STANDARD: TargetAllocation = { BTC: 20, MSTR: 10, SOXL: 15, SOXX: 0, QQQM: 25, '2330': 20, '0052': 10, SGOV: 0 }
const T5_AGGRESSIVE: TargetAllocation = { ...T5_STANDARD, SOXL: 25, QQQM: 15 }
const STAGE2: TargetAllocation = { BTC: 20, MSTR: 5, SOXL: 10, SOXX: 0, QQQM: 25, '2330': 20, '0052': 10, SGOV: 10 }
const STAGE3: TargetAllocation = { BTC: 25, MSTR: 0, SOXL: 0, SOXX: 10, QQQM: 25, '2330': 20, '0052': 10, SGOV: 10 }

export function determineStage(totalTwd: number): Stage {
  if (totalTwd >= STAGE_THRESHOLDS.stage3) return 3
  if (totalTwd >= STAGE_THRESHOLDS.stage2) return 2
  return 1
}

/** 積極版只在階段 1 生效 */
export function getTargetAllocation(stage: Stage, aggressive: boolean): TargetAllocation {
  if (stage === 3) return { ...STAGE3 }
  if (stage === 2) return { ...STAGE2 }
  return aggressive ? { ...T5_AGGRESSIVE } : { ...T5_STANDARD }
}

/** 階段進度：目前階段內往下一門檻走了多少（0～100）；階段 3 固定 100 */
export function stageProgress(totalTwd: number): { stage: Stage; progressPct: number; nextThreshold: number | null } {
  const stage = determineStage(totalTwd)
  if (stage === 3) return { stage, progressPct: 100, nextThreshold: null }
  const lo = stage === 1 ? 0 : STAGE_THRESHOLDS.stage2
  const hi = stage === 1 ? STAGE_THRESHOLDS.stage2 : STAGE_THRESHOLDS.stage3
  const pct = Math.max(0, Math.min(100, ((totalTwd - lo) / (hi - lo)) * 100))
  return { stage, progressPct: pct, nextThreshold: hi }
}

// ───────────────────────── 半年再平衡（6/15、12/15） ─────────────────────────

const DAY_MS = 24 * 3600 * 1000
export const REBALANCE_WINDOW_DAYS = 7

/** 只取日期（本地時區）並轉成 UTC 午夜的毫秒數，避免時區造成差一天 */
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

function anchorsAround(year: number): number[] {
  return [
    Date.UTC(year - 1, 11, 15),
    Date.UTC(year, 5, 15),
    Date.UTC(year, 11, 15),
    Date.UTC(year + 1, 5, 15),
  ]
}

export interface RebalanceSchedule {
  /** 下一次（含今天）半年再平衡日 YYYY-MM-DD */
  nextDate: string
  daysUntilNext: number
  /** 最近的一次再平衡日（可能已過去）*/
  nearestDate: string
  /** 今天 − 最近再平衡日（負數＝還沒到） */
  offsetFromNearest: number
  inWindow: boolean
}

export function rebalanceSchedule(today: Date): RebalanceSchedule {
  const t = dayNumber(today)
  const anchors = anchorsAround(today.getFullYear())
  const next = anchors.find((a) => a >= t)!
  let nearest = anchors[0]
  for (const a of anchors) if (Math.abs(a - t) < Math.abs(nearest - t)) nearest = a
  const offset = Math.round((t - nearest) / DAY_MS)
  return {
    nextDate: new Date(next).toISOString().slice(0, 10),
    daysUntilNext: Math.round((next - t) / DAY_MS),
    nearestDate: new Date(nearest).toISOString().slice(0, 10),
    offsetFromNearest: offset,
    inWindow: Math.abs(offset) <= REBALANCE_WINDOW_DAYS,
  }
}

// ───────────────────────── 持倉彙總 ─────────────────────────

export interface HoldingInput {
  symbol: string
  /** 市值（TWD） */
  valueTwd: number
}

export interface SleeveWeight {
  sleeve: Sleeve
  valueTwd: number
  weightPct: number
  targetPct: number
}

export interface HoldingSummary {
  totalTwd: number
  sleeves: Record<Sleeve, SleeveWeight>
  /** 規則外持倉（現金、其他 ETF 等）合計 */
  otherTwd: number
  otherPct: number
}

export function summarizeHoldings(holdings: HoldingInput[], target: TargetAllocation): HoldingSummary {
  const values: Record<Sleeve, number> = { BTC: 0, MSTR: 0, SOXL: 0, SOXX: 0, QQQM: 0, '2330': 0, '0052': 0, SGOV: 0 }
  let total = 0
  let other = 0
  for (const h of holdings) {
    const v = Number(h.valueTwd)
    if (!Number.isFinite(v) || v <= 0) continue
    total += v
    const s = toSleeve(h.symbol)
    if (s) values[s] += v
    else other += v
  }
  const sleeves = {} as Record<Sleeve, SleeveWeight>
  for (const s of SLEEVES) {
    sleeves[s] = {
      sleeve: s,
      valueTwd: values[s],
      weightPct: total > 0 ? (values[s] / total) * 100 : 0,
      targetPct: target[s],
    }
  }
  return { totalTwd: total, sleeves, otherTwd: other, otherPct: total > 0 ? (other / total) * 100 : 0 }
}

// ───────────────────────── 再平衡差額 ─────────────────────────

export interface RebalanceDiffRow {
  sleeve: Sleeve
  currentTwd: number
  targetTwd: number
  /** 正數＝低配要補、負數＝超標 */
  diffTwd: number
  /** 用當月新資金補進的金額 */
  buyWithCashTwd: number
  /** 新資金不夠時需要賣出的超標金額 */
  sellTwd: number
}

export interface RebalanceDiffPlan {
  rows: RebalanceDiffRow[]
  totalGapTwd: number
  newCashTwd: number
  cashCoversGap: boolean
  /** 新資金補完缺口後剩下的金額 */
  leftoverCashTwd: number
  /** 需賣出的超標部位合計 */
  totalSellTwd: number
}

/**
 * 半年再平衡差額：優先用當月新資金補低配；新資金不夠時，不足的缺口由超標部位依超標比例賣出補足。
 * 目標市值以「目前總投資資產」為基準。
 */
export function planRebalanceDiff(summary: HoldingSummary, newCashTwd: number): RebalanceDiffPlan {
  const cash = Math.max(0, Number.isFinite(newCashTwd) ? newCashTwd : 0)
  const base = summary.totalTwd
  const raw = SLEEVES.map((s) => {
    const cur = summary.sleeves[s].valueTwd
    const tgt = (summary.sleeves[s].targetPct / 100) * base
    return { sleeve: s, currentTwd: cur, targetTwd: tgt, diffTwd: tgt - cur }
  }).filter((r) => r.currentTwd > 0 || r.targetTwd > 0)

  const totalGap = raw.reduce((s, r) => s + Math.max(0, r.diffTwd), 0)
  const totalExcess = raw.reduce((s, r) => s + Math.max(0, -r.diffTwd), 0)
  const cashUsed = Math.min(cash, totalGap)
  const shortfall = Math.max(0, totalGap - cash)
  const sellNeeded = Math.min(shortfall, totalExcess)

  const rows: RebalanceDiffRow[] = raw.map((r) => {
    const gap = Math.max(0, r.diffTwd)
    const excess = Math.max(0, -r.diffTwd)
    return {
      ...r,
      buyWithCashTwd: totalGap > 0 ? (gap / totalGap) * cashUsed : 0,
      sellTwd: totalExcess > 0 ? (excess / totalExcess) * sellNeeded : 0,
    }
  })

  return {
    rows,
    totalGapTwd: totalGap,
    newCashTwd: cash,
    cashCoversGap: cash >= totalGap,
    leftoverCashTwd: Math.max(0, cash - totalGap),
    totalSellTwd: sellNeeded,
  }
}

// ───────────────────────── 行動建議 ─────────────────────────

export type RuleCategory = 'stage' | 'rebalance' | 'fuse' | 'market' | 'option' | 'data'

export interface RuleAdvice {
  id: string
  light: Light
  category: RuleCategory
  title: string
  detail: string
  /** 建議移轉的金額（TWD），有計算時才帶 */
  amountTwd?: number
}

export interface AdvisorInput {
  holdings: HoldingInput[]
  /** key 為 Yahoo 代碼（BTC-USD、SOXX…） */
  market: Partial<Record<string, MarketRadarMetrics | null>>
  today: Date
  aggressive: boolean
  monthlyCashTwd?: number
}

export interface AdvisorResult {
  stage: Stage
  stageName: string
  progressPct: number
  nextThreshold: number | null
  aggressiveApplied: boolean
  target: TargetAllocation
  summary: HoldingSummary
  schedule: RebalanceSchedule
  rebalancePlan: RebalanceDiffPlan | null
  advices: RuleAdvice[]
  overall: 'green' | 'orange' | 'red'
  headline: string
}

export const FUSE_RULES: { sleeve: Sleeve; triggerPct: number; trimToPct: number | 'target'; into: string }[] = [
  { sleeve: 'SOXL', triggerPct: 30, trimToPct: 'target', into: 'SOXX／QQQM' },
  { sleeve: 'MSTR', triggerPct: 20, trimToPct: 10, into: 'BTC 現貨／SGOV' },
  { sleeve: 'BTC', triggerPct: 35, trimToPct: 20, into: 'SGOV／低配標的' },
]

const twd = (n: number) => `NT$ ${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${n.toFixed(1)}%`

function m(market: AdvisorInput['market'], key: string): MarketRadarMetrics | null {
  return market[key] ?? null
}

export function evaluateStrategy(input: AdvisorInput): AdvisorResult {
  const advices: RuleAdvice[] = []
  const rawTotal = input.holdings.reduce((s, h) => s + (Number.isFinite(h.valueTwd) && h.valueTwd > 0 ? h.valueTwd : 0), 0)
  const { stage, progressPct, nextThreshold } = stageProgress(rawTotal)
  const aggressiveApplied = stage === 1 && input.aggressive
  const target = getTargetAllocation(stage, input.aggressive)
  const summary = summarizeHoldings(input.holdings, target)
  const w = (s: Sleeve) => summary.sleeves[s].weightPct
  const hasHoldings = summary.totalTwd > 0

  // 1. 資產階段
  if (!hasHoldings) {
    advices.push({
      id: 'stage-empty',
      light: 'green',
      category: 'stage',
      title: '尚未建倉：依 T5 標準配置開始定投',
      detail: '目前沒有任何持倉市值，規則引擎以階段 1（衝刺期）目標配置作為起步參考。',
    })
  } else if (stage === 1) {
    advices.push({
      id: 'stage-1',
      light: 'green',
      category: 'stage',
      title: `階段 1 衝刺期：${aggressiveApplied ? '起步超跌積極版（SOXL 25% / QQQM 15%）' : 'T5 標準配置'}`,
      detail: `總投資資產 ${twd(summary.totalTwd)}，距離 300 萬（啟用 SGOV 10%）還差 ${twd(STAGE_THRESHOLDS.stage2 - summary.totalTwd)}。`,
    })
  } else if (stage === 2) {
    const ok = w('SGOV') >= 8 && w('SOXL') <= 12 && w('MSTR') <= 7
    advices.push({
      id: 'stage-2',
      light: ok ? 'green' : 'orange',
      category: 'stage',
      title: ok ? '階段 2 成長期：配置已到位' : '階段 2 成長期：請啟用 SGOV 10%，SOXL 降至 10%、MSTR 降至 5%',
      detail: `目前 SGOV ${pct(w('SGOV'))}、SOXL ${pct(w('SOXL'))}、MSTR ${pct(w('MSTR'))}。新資金優先補 SGOV，超標部分於半年再平衡時處理。${input.aggressive ? '（積極版只在階段 1 生效，已自動改用階段 2 配置）' : ''}`,
    })
  } else {
    const ok = w('SOXL') < 0.5 && w('MSTR') < 0.5 && w('SGOV') >= 10 && w('SGOV') <= 20
    advices.push({
      id: 'stage-3',
      light: ok ? 'green' : 'orange',
      category: 'stage',
      title: ok ? '階段 3 守成衝刺期：配置已到位' : '階段 3 守成衝刺期：SOXL 全數轉 SOXX 10%、MSTR 歸零轉回 BTC 現貨、SGOV 10%～20%',
      detail: `目前 SOXL ${pct(w('SOXL'))}、MSTR ${pct(w('MSTR'))}、SOXX ${pct(w('SOXX'))}、SGOV ${pct(w('SGOV'))}。`,
    })
  }

  // 2. 半年再平衡
  const schedule = rebalanceSchedule(input.today)
  let rebalancePlan: RebalanceDiffPlan | null = null
  if (schedule.inWindow && hasHoldings) {
    rebalancePlan = planRebalanceDiff(summary, input.monthlyCashTwd ?? 0)
    const when =
      schedule.offsetFromNearest === 0
        ? '今天就是'
        : schedule.offsetFromNearest < 0
        ? `${-schedule.offsetFromNearest} 天後是`
        : `${schedule.offsetFromNearest} 天前是`
    advices.push({
      id: 'rebalance-window',
      light: 'orange',
      category: 'rebalance',
      title: `半年再平衡視窗：${when} ${schedule.nearestDate.slice(5).replace('-', '/')} 再平衡日`,
      detail: rebalancePlan.cashCoversGap
        ? `低配缺口合計 ${twd(rebalancePlan.totalGapTwd)}，當月新資金 ${twd(rebalancePlan.newCashTwd)} 足夠補齊，不需賣出。`
        : `低配缺口合計 ${twd(rebalancePlan.totalGapTwd)}，新資金 ${twd(rebalancePlan.newCashTwd)} 不夠，需賣出超標部位約 ${twd(rebalancePlan.totalSellTwd)}（明細見下表）。`,
      amountTwd: rebalancePlan.totalGapTwd,
    })
  } else {
    advices.push({
      id: 'rebalance-countdown',
      light: 'green',
      category: 'rebalance',
      title: `距離下次半年再平衡（${schedule.nextDate.slice(5).replace('-', '/')}）還有 ${schedule.daysUntilNext} 天，照常定投即可`,
      detail: '半年再平衡在每年 6/15 與 12/15 前後 7 天內執行。',
    })
  }

  // 3. 2 倍暴衝保險絲（單邊修剪）
  if (hasHoldings) {
    for (const f of FUSE_RULES) {
      const weight = w(f.sleeve)
      const trimTo = f.trimToPct === 'target' ? target[f.sleeve] : f.trimToPct
      if (weight >= f.triggerPct) {
        const excessTwd = ((weight - trimTo) / 100) * summary.totalTwd
        advices.push({
          id: `fuse-${f.sleeve}`,
          light: 'red',
          category: 'fuse',
          title: `${f.sleeve} 暴衝保險絲觸發：權重 ${pct(weight)} ≥ ${f.triggerPct}%`,
          detail: `賣出超過 ${trimTo}% 的部分約 ${twd(excessTwd)}，轉進 ${f.into}。只修剪超標部分，不提早賣光贏家。`,
          amountTwd: excessTwd,
        })
      }
    }
  }

  // 4. 市場位階
  const soxx = m(input.market, 'SOXX')
  const mstr = m(input.market, 'MSTR')
  const qqq = m(input.market, 'QQQ')
  const btc = m(input.market, 'BTC-USD')

  const soxlActive = target.SOXL > 0
  if (!soxx) {
    advices.push({ id: 'soxx-missing', light: 'unknown', category: 'data', title: 'SOXX 行情暫缺', detail: '無法判斷 SOXL 降檔／過熱條件，請稍後重新整理。' })
  } else if (soxlActive) {
    if (aggressiveApplied && soxx.aboveMa200) {
      advices.push({
        id: 'soxl-aggressive-exit',
        light: 'orange',
        category: 'market',
        title: 'SOXX 已站回 200MA：積極版 SOXL 25% 請降回 15%',
        detail: `SOXX 距 200MA ${pct(soxx.distanceToMa200Pct ?? 0)}。把多出的 10% 轉進 QQQM／SOXX，並把開關切回標準版。`,
        amountTwd: hasHoldings ? Math.max(0, ((w('SOXL') - 15) / 100) * summary.totalTwd) : undefined,
      })
    }
    if (soxx.weeklyRsi14 !== null && soxx.weeklyRsi14 > 75) {
      advices.push({
        id: 'soxx-overheat',
        light: 'orange',
        category: 'market',
        title: `SOXX 週 RSI ${soxx.weeklyRsi14.toFixed(1)} > 75：半導體過熱，新資金停買 SOXL`,
        detail: '本月 SOXL 份額改投 SOXX 或 SGOV；等週 RSI 回落 70 以下再恢復買 SOXL。',
      })
    } else if (soxx.weeklyRsi14 !== null && soxx.weeklyRsi14 > 70) {
      advices.push({
        id: 'soxx-cooling',
        light: 'info',
        category: 'market',
        title: `SOXX 週 RSI ${soxx.weeklyRsi14.toFixed(1)}（70～75 緩衝區）`,
        detail: '若先前已因過熱暫停 SOXL，需等週 RSI 回落 70 以下才恢復；未暫停則照常。',
      })
    } else {
      advices.push({
        id: 'soxx-normal',
        light: 'green',
        category: 'market',
        title: `SOXX 週 RSI ${soxx.weeklyRsi14?.toFixed(1) ?? '—'}：SOXL 照常扣款`,
        detail: `SOXX ${soxx.aboveMa200 ? '在 200MA 上方' : '在 200MA 下方'}（距離 ${pct(soxx.distanceToMa200Pct ?? 0)}），距區間高點 ${pct(soxx.drawdownFromAthPct)}。`,
      })
    }
  }

  const mstrActive = target.MSTR > 0
  if (!mstr) {
    advices.push({ id: 'mstr-missing', light: 'unknown', category: 'data', title: 'MSTR 行情暫缺', detail: '無法判斷 MSTR 過熱條件，請稍後重新整理。' })
  } else if (mstrActive) {
    if (mstr.weeklyRsi14 !== null && mstr.weeklyRsi14 > 75) {
      advices.push({
        id: 'mstr-overheat',
        light: 'orange',
        category: 'market',
        title: `MSTR 週 RSI ${mstr.weeklyRsi14.toFixed(1)} > 75：牛市過熱，新資金停買 MSTR`,
        detail: '本月 MSTR 份額改投 BTC 現貨或 SGOV。請人工確認 mNAV 是否 > 2.5 倍；等下一輪熊市 MSTR 距高點跌破 -50% 再重啟。',
      })
    } else if (mstr.drawdownFromAthPct <= -50) {
      advices.push({
        id: 'mstr-bear-restart',
        light: 'green',
        category: 'market',
        title: `MSTR 距高點 ${pct(mstr.drawdownFromAthPct)}：熊市重啟條件成立`,
        detail: '若先前因過熱暫停 MSTR，現在可恢復定投。',
      })
    } else {
      advices.push({
        id: 'mstr-normal',
        light: 'green',
        category: 'market',
        title: `MSTR 週 RSI ${mstr.weeklyRsi14?.toFixed(1) ?? '—'}：照常扣款`,
        detail: `距區間高點 ${pct(mstr.drawdownFromAthPct)}。若先前已因過熱暫停，需等距高點跌破 -50% 才重啟。`,
      })
    }
  }

  // 5. 選配開關
  if (qqq) {
    if (qqq.aboveMa200 === false) {
      advices.push({ id: 'qld-hold', light: 'green', category: 'option', title: 'QQQ 在 200MA 下方：維持 QQQM，暫不切 QLD', detail: `QQQ 距 200MA ${pct(qqq.distanceToMa200Pct ?? 0)}。` })
    } else if (qqq.aboveMa200 && qqq.weeklyRsi14 !== null && qqq.weeklyRsi14 >= 50 && qqq.weeklyRsi14 <= 70) {
      advices.push({
        id: 'qld-option',
        light: 'info',
        category: 'option',
        title: `QQQ 站上 200MA 且週 RSI ${qqq.weeklyRsi14.toFixed(1)}（50～70）：可選配部分 QLD`,
        detail: '選配：可把 QQQM 槽位的一部分切換為 QLD（2 倍），非必要動作。',
      })
    } else {
      advices.push({
        id: 'qld-wait',
        light: 'green',
        category: 'option',
        title: `QQQ 週 RSI ${qqq.weeklyRsi14?.toFixed(1) ?? '—'}：維持 QQQM`,
        detail: 'QLD 選配條件為「站上 200MA 且週 RSI 介於 50～70」，目前不符合。',
      })
    }
  }

  if (!btc) {
    advices.push({ id: 'btc-missing', light: 'unknown', category: 'data', title: 'BTC 行情暫缺', detail: '無法判斷 BTC 200MA 狀態，請稍後重新整理。' })
  } else if (btc.weeklyCloseAboveMa200) {
    advices.push({
      id: 'btc-leverage-option',
      light: 'info',
      category: 'option',
      title: 'BTC 週收盤站上 200MA：可選配開 1.5x 半倉',
      detail: '選配：LTV 上限 40%；一旦跌破 200MA 全數還款。非必要動作。',
    })
  } else {
    advices.push({
      id: 'btc-spot-only',
      light: 'green',
      category: 'option',
      title: btc.aboveMa200 ? 'BTC 日線站上 200MA，但週收盤尚未確認：維持 100% 現貨' : 'BTC 在 200MA 下方：維持 100% BTC 現貨，不開借貸',
      detail: `BTC 距 200MA ${pct(btc.distanceToMa200Pct ?? 0)}，週 RSI ${btc.weeklyRsi14?.toFixed(1) ?? '—'}。`,
    })
  }

  const order: Record<Light, number> = { red: 0, orange: 1, info: 2, unknown: 3, green: 4 }
  advices.sort((a, b) => order[a.light] - order[b.light])

  const reds = advices.filter((a) => a.light === 'red')
  const oranges = advices.filter((a) => a.light === 'orange')
  const overall: AdvisorResult['overall'] = reds.length ? 'red' : oranges.length ? 'orange' : 'green'
  const headline =
    overall === 'green'
      ? '目前無觸發警戒，照常執行每月定投'
      : `今日有 ${reds.length + oranges.length} 項需要動作：${[...reds, ...oranges].map((a) => a.title.split('：')[0]).join('、')}`

  return {
    stage,
    stageName: STAGE_INFO[stage].name,
    progressPct,
    nextThreshold,
    aggressiveApplied,
    target,
    summary,
    schedule,
    rebalancePlan,
    advices,
    overall,
    headline,
  }
}
