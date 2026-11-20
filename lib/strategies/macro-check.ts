/**
 * SOXL 狙擊的「下跌原因」判斷：恐慌／估值修正（可狙擊）vs 景氣衰退 vs 產業倒退／泡沫破裂
 * 純計算，資料由 API 抓好傳進來。門檻集中在 MACRO_CONFIG。
 */

export type MacroLight = 'green' | 'yellow' | 'red' | 'gray'

export interface MacroCheck {
  key: string
  label: string
  value: string
  light: MacroLight
  note: string
  source: string
}

export const MACRO_CONFIG = {
  sahmRecession: 0.5, // Sahm ≥ 0.5 = 衰退開始
  sahmWarn: 0.3,
  vixPanic: 35, // VIX ≥ 35 = 恐慌性拋售（對狙擊有利）
  creditStressPct: -5, // HYG/IEF 3 個月跌超過 5% = 信用緊縮
  tsmcNegativeMonths: 3, // 台積電營收年增率連續 3 個月衰退 = 產業倒退
  bubblePeakTo200w: 2.5, // 高點時 SOXX ÷ 200 週均線 ≥ 2.5 倍 = 過熱（2000 年網路泡沫約 3 倍以上）
  bubbleWarnTo200w: 2.0,
}

/** Sahm 指標：近 3 個月平均失業率 − 前 12 個月內「3 個月平均」的最低值 */
export function sahmRule(rates: number[]): number | null {
  if (rates.length < 15) return null
  const ma3 = rates.map((_, i) => (i < 2 ? null : (rates[i] + rates[i - 1] + rates[i - 2]) / 3))
  const last = ma3[ma3.length - 1] as number
  const prior = ma3.slice(-13, -1).filter((v): v is number => v != null)
  if (!prior.length) return null
  return Number((last - Math.min(...prior)).toFixed(2))
}

/** 年增率（%），輸入依月份排序的營收 */
export function yoySeries(rows: { ym: string; revenue: number }[]) {
  const map = new Map(rows.map((r) => [r.ym, r.revenue]))
  return rows
    .map((r) => {
      const [y, m] = r.ym.split('-')
      const prev = map.get(`${Number(y) - 1}-${m}`)
      return prev ? { ym: r.ym, yoy: (r.revenue / prev - 1) * 100 } : null
    })
    .filter((x): x is { ym: string; yoy: number } => x != null)
}

export interface MacroInputs {
  unemployment: number[] | null
  tnx: number | null // 10 年期殖利率（%）
  irx: number | null // 13 週國庫券殖利率（%）
  vix: number | null
  hygIefChange3m: number | null // HYG/IEF 比值 3 個月變化（%）
  tsmcRevenue: { ym: string; revenue: number }[] | null
  soxxPeakTo200w: number | null // 本輪高點時，SOXX ÷ 當時 200 週均線
}

export type MacroVerdict = 'PANIC' | 'OVERHEAT' | 'RECESSION' | 'STRUCTURAL' | 'UNKNOWN'

export const VERDICT_INFO: Record<MacroVerdict, { label: string; light: MacroLight; desc: string }> = {
  PANIC: { label: '恐慌或估值修正', light: 'green', desc: '基本面沒有明顯惡化，屬於可以狙擊的下跌' },
  OVERHEAT: { label: '前一波過熱後的修正', light: 'yellow', desc: '基本面還好，但前波漲太多，修復期較長；可進場但拉長分批間隔' },
  RECESSION: { label: '景氣衰退', light: 'yellow', desc: '經濟轉弱，可以進場但拉長分批間隔、每批確認止跌' },
  STRUCTURAL: { label: '產業倒退或泡沫破裂', light: 'red', desc: '台積電營收連續衰退，或前波過熱且營收轉弱，先不買' },
  UNKNOWN: { label: '資料不足', light: 'gray', desc: '總經資料抓不到，請人工判斷' },
}

export function evaluateMacro(inp: MacroInputs) {
  const C = MACRO_CONFIG
  const checks: MacroCheck[] = []

  const sahm = inp.unemployment ? sahmRule(inp.unemployment) : null
  checks.push({
    key: 'sahm',
    label: 'Sahm 衰退指標',
    value: sahm != null ? sahm.toFixed(2) : '—',
    light: sahm == null ? 'gray' : sahm >= C.sahmRecession ? 'red' : sahm >= C.sahmWarn ? 'yellow' : 'green',
    note: `≥ ${C.sahmRecession} 代表衰退已開始`,
    source: 'BLS 失業率',
  })

  const spread = inp.tnx != null && inp.irx != null ? inp.tnx - inp.irx : null
  checks.push({
    key: 'curve',
    label: '10 年 − 3 個月利差',
    value: spread != null ? `${spread.toFixed(2)}%` : '—',
    light: spread == null ? 'gray' : spread < 0 ? 'yellow' : 'green',
    note: '倒掛（負值）代表 6～18 個月內衰退風險升高',
    source: 'Yahoo ^TNX / ^IRX',
  })

  checks.push({
    key: 'credit',
    label: '信用市場（HYG÷IEF 3 個月變化）',
    value: inp.hygIefChange3m != null ? `${inp.hygIefChange3m.toFixed(1)}%` : '—',
    light: inp.hygIefChange3m == null ? 'gray' : inp.hygIefChange3m <= C.creditStressPct ? 'red' : inp.hygIefChange3m < -2 ? 'yellow' : 'green',
    note: `跌超過 ${Math.abs(C.creditStressPct)}% 代表高收益債被拋售、信用緊縮`,
    source: 'Yahoo HYG / IEF',
  })

  checks.push({
    key: 'vix',
    label: 'VIX 恐慌指數',
    value: inp.vix != null ? inp.vix.toFixed(1) : '—',
    light: inp.vix == null ? 'gray' : inp.vix >= C.vixPanic ? 'green' : 'yellow',
    note: `≥ ${C.vixPanic} 屬恐慌性下跌，通常是較好的狙擊點`,
    source: 'Yahoo ^VIX',
  })

  const yoy = inp.tsmcRevenue ? yoySeries(inp.tsmcRevenue) : []
  const last3 = yoy.slice(-C.tsmcNegativeMonths)
  const negMonths = last3.filter((x) => x.yoy < 0).length
  const lastYoy = yoy.at(-1)
  checks.push({
    key: 'tsmc',
    label: '台積電月營收年增率',
    value: lastYoy ? `${lastYoy.yoy.toFixed(1)}%（${lastYoy.ym}）` : '—',
    light: !lastYoy ? 'gray' : negMonths >= C.tsmcNegativeMonths ? 'red' : negMonths > 0 ? 'yellow' : 'green',
    note: `連續 ${C.tsmcNegativeMonths} 個月衰退代表半導體產業倒退`,
    source: 'FinMind',
  })

  checks.push({
    key: 'bubble',
    label: '高點時 SOXX ÷ 200 週均線',
    value: inp.soxxPeakTo200w != null ? `${inp.soxxPeakTo200w.toFixed(2)} 倍` : '—',
    light: inp.soxxPeakTo200w == null ? 'gray' : inp.soxxPeakTo200w >= C.bubblePeakTo200w ? 'red' : inp.soxxPeakTo200w >= C.bubbleWarnTo200w ? 'yellow' : 'green',
    note: `≥ ${C.bubblePeakTo200w} 倍代表前一波是泡沫，破裂後修復較久`,
    source: 'Yahoo 週 K 計算',
  })

  const by = (k: string) => checks.find((c) => c.key === k)!
  const known = checks.filter((c) => c.light !== 'gray').length
  let verdict: MacroVerdict
  // 決定性指標（營收、Sahm、信用）任一缺值，就不能下「可狙擊」結論
  const keyMissing = ['tsmc', 'sahm', 'credit'].some((k) => by(k).light === 'gray')
  if (known < 3) verdict = 'UNKNOWN'
  // 產業倒退：台積電營收連續衰退；泡沫破裂：前波過熱「而且」營收已開始轉弱
  else if (by('tsmc').light === 'red' || (by('bubble').light === 'red' && by('tsmc').light === 'yellow'))
    verdict = 'STRUCTURAL'
  else if (by('sahm').light === 'red' || by('credit').light === 'red') verdict = 'RECESSION'
  else if (keyMissing) verdict = 'UNKNOWN'
  else if (by('bubble').light === 'red') verdict = 'OVERHEAT'
  else verdict = 'PANIC'

  return { verdict, ...VERDICT_INFO[verdict], checks, sahm, spread, tsmcYoy: yoy.slice(-12) }
}
