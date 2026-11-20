/**
 * BTC 週期位置 ＋ MSTR 溢價 → MSTR / BTC 目標比例與加減碼燈號
 *
 * 純計算，不碰網路與資料庫（方便測試）。所有門檻集中在 BTC_CYCLE_CONFIG，可依需要調整。
 *
 * 週期分數：0 = 熊市底部、100 = 牛市頂部，由 5 個指標加權平均（缺資料的指標不計、權重重新分配）。
 */

export interface IndicatorScore {
  key: string
  label: string
  value: number | null // 指標原始值
  display: string // 給畫面顯示的文字
  score: number | null // 0～100
  weight: number
  bottomHint: string // 什麼數值算底部
  topHint: string // 什麼數值算頂部
  source: string
  stale: boolean
}

export const HALVING_DATES = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20']

export const BTC_CYCLE_CONFIG = {
  // [底部值, 頂部值]：線性換算成 0～100
  mvrv: { bottom: 0.8, top: 3.7, weight: 35 },
  priceTo200w: { bottom: 1.0, top: 4.0, weight: 30 },
  mayer: { bottom: 0.7, top: 2.4, weight: 15 },
  fearGreed: { bottom: 10, top: 90, weight: 10 },
  halving: { weight: 10 },
  // 減半後月數 → 分數（歷史上約 12～18 個月見頂、30～36 個月見底）
  halvingCurve: [
    [0, 40],
    [12, 80],
    [18, 100],
    [24, 60],
    [30, 10],
    [36, 15],
    [48, 40],
  ] as [number, number][],
  // 週期分數 → MSTR 占加密部位的基本比例（%）
  mstrShareCurve: [
    [0, 75],
    [30, 70],
    [50, 50],
    [75, 25],
    [90, 0],
    [100, 0],
  ] as [number, number][],
  // mNAV 溢價調整（百分點）：便宜多配 MSTR、貴則換回 BTC
  mnavAdjust: [
    { max: 1.0, adj: 10, label: '折價（低於持幣價值）' },
    { max: 1.5, adj: 5, label: '偏便宜' },
    { max: 2.0, adj: 0, label: '合理' },
    { max: 2.5, adj: -10, label: '偏貴' },
    { max: Infinity, adj: -20, label: '昂貴' },
  ],
  mstrShareMax: 80,
  cryptoTargetPercent: 25, // 加密部位占總資產目標
  cryptoBandPp: 5, // 總加密部位容許偏離 ±5 個百分點
  innerBandPp: 5, // MSTR 占加密部位容許偏離 ±5 個百分點
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/** 線性換算到 0～100 */
export function linearScore(v: number, bottom: number, top: number) {
  return clamp(((v - bottom) / (top - bottom)) * 100, 0, 100)
}

/** 折線插值 */
export function interpolate(curve: [number, number][], x: number) {
  if (x <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]
    const [x0, y0] = curve[i - 1]
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return curve[curve.length - 1][1]
}

export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null
  const slice = values.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

export function monthsSinceLastHalving(now: Date) {
  const past = HALVING_DATES.map((d) => new Date(d)).filter((d) => d <= now)
  const last = past[past.length - 1]
  return (now.getTime() - last.getTime()) / (1000 * 3600 * 24 * 30.4375)
}

export type Phase = 'ACCUMULATE' | 'EARLY_BULL' | 'MID_BULL' | 'LATE_BULL' | 'EUPHORIA'

export const PHASE_INFO: Record<Phase, { label: string; desc: string }> = {
  ACCUMULATE: { label: '熊市底部累積區', desc: '估值低、情緒悲觀，適合重倉 MSTR 放大反彈' },
  EARLY_BULL: { label: '牛市初期', desc: '脫離底部，MSTR 仍有槓桿優勢' },
  MID_BULL: { label: '牛市中期', desc: 'MSTR 與 BTC 平衡配置' },
  LATE_BULL: { label: '牛市後期', desc: '逐步把 MSTR 換回 BTC，不再加碼' },
  EUPHORIA: { label: '過熱區', desc: '市場狂熱，停止加碼並考慮減碼加密部位' },
}

export function phaseFromScore(score: number): Phase {
  if (score < 25) return 'ACCUMULATE'
  if (score < 50) return 'EARLY_BULL'
  if (score < 75) return 'MID_BULL'
  if (score < 90) return 'LATE_BULL'
  return 'EUPHORIA'
}

export interface CycleInputs {
  now: Date
  btcPrice: number
  btcWeeklyCloses: number[] // 至少 200 週才算得出 200 週均線
  btcDailyCloses: number[] // 至少 200 天
  mvrv: number | null
  fearGreed: number | null
  stale: { price: boolean; mvrv: boolean; fearGreed: boolean }
}

export function scoreCycle(inp: CycleInputs) {
  const C = BTC_CYCLE_CONFIG
  const ma200w = sma(inp.btcWeeklyCloses, 200)
  const ma200d = sma(inp.btcDailyCloses, 200)
  const priceTo200w = ma200w ? inp.btcPrice / ma200w : null
  const mayer = ma200d ? inp.btcPrice / ma200d : null
  const months = monthsSinceLastHalving(inp.now)

  const indicators: IndicatorScore[] = [
    {
      key: 'mvrv',
      label: 'MVRV（市值 ÷ 已實現市值）',
      value: inp.mvrv,
      display: inp.mvrv != null ? inp.mvrv.toFixed(2) : '—',
      score: inp.mvrv != null ? linearScore(inp.mvrv, C.mvrv.bottom, C.mvrv.top) : null,
      weight: C.mvrv.weight,
      bottomHint: `< ${C.mvrv.bottom}`,
      topHint: `> ${C.mvrv.top}`,
      source: 'CoinMetrics',
      stale: inp.stale.mvrv,
    },
    {
      key: 'priceTo200w',
      label: '價格 ÷ 200 週均線',
      value: priceTo200w,
      display: priceTo200w != null ? `${priceTo200w.toFixed(2)} 倍` : '資料不足',
      score: priceTo200w != null ? linearScore(priceTo200w, C.priceTo200w.bottom, C.priceTo200w.top) : null,
      weight: C.priceTo200w.weight,
      bottomHint: `< ${C.priceTo200w.bottom} 倍`,
      topHint: `> ${C.priceTo200w.top} 倍`,
      source: 'Yahoo 週 K 計算',
      stale: inp.stale.price,
    },
    {
      key: 'mayer',
      label: 'Mayer 倍數（價格 ÷ 200 日均線）',
      value: mayer,
      display: mayer != null ? mayer.toFixed(2) : '資料不足',
      score: mayer != null ? linearScore(mayer, C.mayer.bottom, C.mayer.top) : null,
      weight: C.mayer.weight,
      bottomHint: `< ${C.mayer.bottom}`,
      topHint: `> ${C.mayer.top}`,
      source: 'Yahoo 日 K 計算',
      stale: inp.stale.price,
    },
    {
      key: 'fearGreed',
      label: '恐懼與貪婪指數',
      value: inp.fearGreed,
      display: inp.fearGreed != null ? String(inp.fearGreed) : '—',
      score: inp.fearGreed != null ? linearScore(inp.fearGreed, C.fearGreed.bottom, C.fearGreed.top) : null,
      weight: C.fearGreed.weight,
      bottomHint: `< ${C.fearGreed.bottom}`,
      topHint: `> ${C.fearGreed.top}`,
      source: 'alternative.me',
      stale: inp.stale.fearGreed,
    },
    {
      key: 'halving',
      label: '距上次減半',
      value: months,
      display: `${months.toFixed(1)} 個月`,
      score: interpolate(C.halvingCurve, months),
      weight: C.halving.weight,
      bottomHint: '30～36 個月',
      topHint: '12～18 個月',
      source: '減半日期計算',
      stale: false,
    },
  ]

  const usable = indicators.filter((i) => i.score != null)
  const totalW = usable.reduce((a, i) => a + i.weight, 0)
  const score = totalW > 0 ? usable.reduce((a, i) => a + (i.score as number) * i.weight, 0) / totalW : 50
  // 主要估值指標（MVRV、200 週）都缺時，分數不可信
  const reliable = indicators.filter((i) => ['mvrv', 'priceTo200w'].includes(i.key) && i.score != null).length > 0

  return { score, phase: phaseFromScore(score), indicators, ma200w, ma200d, reliable }
}

export function mnavInfo(mnav: number | null) {
  if (mnav == null) return { adj: 0, label: '無資料' }
  return BTC_CYCLE_CONFIG.mnavAdjust.find((m) => mnav < m.max) || { adj: 0, label: '—' }
}

export function calculateEvMnav(input: {
  mstrPrice: number
  dilutedShares: number
  btcHeld: number
  btcPrice: number
  netDebtUsd?: number
  preferredStockUsd?: number
}): number | null {
  const { mstrPrice, dilutedShares, btcHeld, btcPrice, netDebtUsd = 0, preferredStockUsd = 0 } = input
  if ([mstrPrice, dilutedShares, btcHeld, btcPrice].some((value) => !Number.isFinite(value) || value <= 0)) return null
  if (![netDebtUsd, preferredStockUsd].every(Number.isFinite)) return null
  const ev = mstrPrice * dilutedShares + netDebtUsd + preferredStockUsd
  const btcNav = btcHeld * btcPrice
  return Number.isFinite(ev) && Number.isFinite(btcNav) && btcNav > 0 ? ev / btcNav : null
}

export function calculateRatioZScore(ratios: number[], window = 60): number | null {
  if (!Number.isInteger(window) || window <= 0 || ratios.length < window) return null
  const values = ratios.slice(-window)
  if (values.some((value) => !Number.isFinite(value))) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / window
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window
  const std = Math.sqrt(variance)
  if (std <= 0) return null
  return Number(((values.at(-1)! - mean) / std).toFixed(2))
}

export type Light = 'green' | 'yellow' | 'red' | 'gray'

export interface Decision {
  light: Light
  title: string
  detail: string
}

export interface AllocationInputs {
  cycleScore: number
  reliable: boolean
  anyStale: boolean
  mnav: number | null
  btcValueUsd: number
  mstrValueUsd: number
  totalPortfolioUsd: number
  btcBelow200dMa?: boolean
  mstrBtcRatioFalling?: boolean
  mstrBtcZScore60d?: number | null
}

export function decideAllocation(inp: AllocationInputs) {
  const C = BTC_CYCLE_CONFIG
  const phase = phaseFromScore(inp.cycleScore)
  const base = interpolate(C.mstrShareCurve, inp.cycleScore)
  const m = mnavInfo(inp.mnav)
  // 過熱區一律 0%，不因 MSTR 便宜而加回
  const leftSideProtectionActive =
    inp.cycleScore < 25 && Boolean(inp.btcBelow200dMa) && Boolean(inp.mstrBtcRatioFalling)
  const targetMstrShare = phase === 'EUPHORIA'
    ? 0
    : clamp(base + m.adj, 0, leftSideProtectionActive ? Math.min(60, C.mstrShareMax) : C.mstrShareMax)
  const tacticalSwapAlert = {
    active: inp.mstrBtcZScore60d != null && inp.mstrBtcZScore60d >= 2.0,
    zScore: inp.mstrBtcZScore60d ?? null,
    message:
      inp.mstrBtcZScore60d != null && inp.mstrBtcZScore60d >= 2.0
        ? 'MSTR 短期相對 BTC 過熱，可考慮戰術性將部分 MSTR 換回 BTC。'
        : '',
  }

  const cryptoValue = inp.btcValueUsd + inp.mstrValueUsd
  const cryptoWeight = inp.totalPortfolioUsd > 0 ? (cryptoValue / inp.totalPortfolioUsd) * 100 : 0
  const actualMstrShare = cryptoValue > 0 ? (inp.mstrValueUsd / cryptoValue) * 100 : 0
  const innerGap = actualMstrShare - targetMstrShare // 正 = MSTR 太多

  const decisions: Decision[] = []

  if (!inp.reliable || inp.anyStale) {
    decisions.push({
      light: 'gray',
      title: '資料不完整或已過期',
      detail: '部分指標抓不到最新資料，燈號僅供參考，請稍後重新整理再做決定。',
    })
  }

  // 1) 整體加密部位：加碼 / 不加碼 / 減碼
  const lo = C.cryptoTargetPercent - C.cryptoBandPp
  const hi = C.cryptoTargetPercent + C.cryptoBandPp
  if (inp.totalPortfolioUsd <= 0 || cryptoValue <= 0) {
    // 沒有持倉資料時，只依週期給方向
    const favorMstr = targetMstrShare >= 50
    decisions.push(
      phase === 'EUPHORIA' || phase === 'LATE_BULL'
        ? {
            light: phase === 'EUPHORIA' ? 'red' : 'yellow',
            title: '週期偏高，新資金不加碼',
            detail: `週期分數 ${inp.cycleScore.toFixed(0)}（${PHASE_INFO[phase].label}），以守住獲利為主。`,
          }
        : {
            light: 'green',
            title: `週期偏低，可加碼（優先 ${favorMstr ? 'MSTR' : 'BTC'}）`,
            detail: `週期分數 ${inp.cycleScore.toFixed(0)}（${PHASE_INFO[phase].label}），新資金建議 MSTR ${targetMstrShare.toFixed(0)}%、BTC ${(100 - targetMstrShare).toFixed(0)}%。`,
          },
      {
        light: 'gray',
        title: '尚未登錄 BTC / MSTR 持倉',
        detail: '到「資產配置」輸入持有數量後，才能計算實際占比與再平衡金額。',
      }
    )
  } else if (phase === 'EUPHORIA') {
    decisions.push({
      light: 'red',
      title: '停止加碼，考慮減碼加密部位',
      detail: `週期分數 ${inp.cycleScore.toFixed(0)} 已進入過熱區；加密部位目前 ${cryptoWeight.toFixed(1)}%，可逐步降到 ${lo}% 下緣，獲利轉入現金預備金。`,
    })
  } else if (phase === 'LATE_BULL') {
    decisions.push({
      light: cryptoWeight > hi ? 'red' : 'yellow',
      title: cryptoWeight > hi ? '牛市後期且超配，減碼回目標' : '牛市後期，新資金不加碼',
      detail: `加密部位目前 ${cryptoWeight.toFixed(1)}%（目標 ${C.cryptoTargetPercent}%）。後期以守住獲利為主。`,
    })
  } else if (cryptoWeight < lo) {
    decisions.push({
      light: 'green',
      title: '加密部位低於目標，可加碼',
      detail: `目前 ${cryptoWeight.toFixed(1)}%，低於 ${lo}% 下緣；依下方比例分配到 MSTR 與 BTC。`,
    })
  } else if (cryptoWeight > hi) {
    decisions.push({
      light: 'yellow',
      title: '加密部位高於目標，暫不加碼',
      detail: `目前 ${cryptoWeight.toFixed(1)}%，高於 ${hi}% 上緣；可考慮把超出部分轉入現金。`,
    })
  } else {
    decisions.push({
      light: 'green',
      title: '加密部位在目標範圍內',
      detail: `目前 ${cryptoWeight.toFixed(1)}%（${lo}～${hi}%），維持定期定額即可。`,
    })
  }

  // 2) 內部 MSTR / BTC 再平衡
  if (cryptoValue > 0) {
    const moveUsd = (Math.abs(innerGap) / 100) * cryptoValue
    if (innerGap < -C.innerBandPp) {
      decisions.push({
        light: 'green',
        title: '加碼 MSTR（由 BTC 換入）',
        detail: `MSTR 占加密部位 ${actualMstrShare.toFixed(1)}%，目標 ${targetMstrShare.toFixed(0)}%；約需換入 US$${Math.round(moveUsd).toLocaleString()}。`,
      })
    } else if (innerGap > C.innerBandPp) {
      decisions.push({
        light: 'yellow',
        title: '減碼 MSTR，換回 BTC',
        detail: `MSTR 占加密部位 ${actualMstrShare.toFixed(1)}%，目標 ${targetMstrShare.toFixed(0)}%；約需換出 US$${Math.round(moveUsd).toLocaleString()}。`,
      })
    } else {
      decisions.push({
        light: 'green',
        title: 'MSTR / BTC 比例正常',
        detail: `MSTR 占 ${actualMstrShare.toFixed(1)}%，與目標 ${targetMstrShare.toFixed(0)}% 相差不到 ${C.innerBandPp} 個百分點，不必調整。`,
      })
    }
  }

  // 總燈號：取最嚴重的（紅 > 黃 > 綠），資料過期時顯示灰
  const order: Light[] = ['red', 'yellow', 'green']
  const lights: Light[] = decisions.map((d) => d.light).filter((l) => l !== 'gray')
  const overall: Light =
    !inp.reliable || inp.anyStale ? 'gray' : order.find((l) => lights.includes(l)) || 'gray'

  return {
    phase,
    baseMstrShare: base,
    mnavAdjust: m.adj,
    mnavLabel: m.label,
    targetMstrShare,
    targetBtcShare: 100 - targetMstrShare,
    actualMstrShare,
    cryptoWeight,
    cryptoValue,
    leftSideProtectionActive,
    leftSideProtectionMessage: leftSideProtectionActive
      ? '熊底保護啟動：BTC 低於 200 日均線且 MSTR/BTC 比值走弱，MSTR 目標上限暫降至 60%。'
      : '',
    tacticalSwapAlert,
    decisions,
    overall,
  }
}
