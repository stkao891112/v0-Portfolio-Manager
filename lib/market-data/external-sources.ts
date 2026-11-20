/**
 * 外部指標資料來源（全部免金鑰、自動抓取）
 *
 * - CoinMetrics 社群版：BTC MVRV
 * - alternative.me：恐懼與貪婪指數
 * - CoinGecko：上市公司持幣（MSTR 持有 BTC 數量）
 * - SEC EDGAR：MSTR 稀釋後股數（每季財報）
 * - BLS：美國失業率（計算 Sahm 衰退指標）
 * - FinMind：台積電月營收
 * - Yahoo Finance：日 K / 週 K、VIX、殖利率、HYG/IEF、匯率
 *
 * 每個來源都先查資料庫快取（indicator_cache），過期才重抓；
 * 重抓失敗時退回舊快取並標示 stale，讓畫面能顯示「資料過期」而不是整頁壞掉。
 */
import { sqlite } from '@/lib/db/client'

export interface Sourced<T> {
  value: T | null
  updatedAt: string | null // 資料抓取時間
  stale: boolean // true = 本次抓取失敗，使用舊快取或沒有資料
  source: string
  error?: string
}

let cacheTableReady = false
async function ensureCacheTable() {
  if (cacheTableReady) return
  await sqlite.exec(`
    CREATE TABLE IF NOT EXISTS indicator_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  cacheTableReady = true
}

/** 依 key 讀快取；超過 ttlSeconds 才呼叫 fetcher 重抓 */
async function cached<T>(
  key: string,
  ttlSeconds: number,
  source: string,
  fetcher: () => Promise<T>
): Promise<Sourced<T>> {
  let row: { json: string; updated_at: string } | undefined
  try {
    await ensureCacheTable()
    row = await sqlite.get<{ json: string; updated_at: string }>(
      'SELECT json, updated_at FROM indicator_cache WHERE key = ?',
      [key]
    )
  } catch {
    row = undefined // 資料庫不能用時直接抓，不快取
  }

  if (row) {
    const age = (Date.now() - new Date(row.updated_at).getTime()) / 1000
    if (age < ttlSeconds) {
      return { value: JSON.parse(row.json), updatedAt: row.updated_at, stale: false, source }
    }
  }

  try {
    const value = await fetcher()
    const now = new Date().toISOString()
    try {
      await sqlite.run(
        `INSERT INTO indicator_cache (key, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), now]
      )
    } catch {
      /* 快取寫入失敗不影響回傳 */
    }
    return { value, updatedAt: now, stale: false, source }
  } catch (err: any) {
    console.warn(`[external-sources] ${key} 抓取失敗:`, err?.message)
    if (row) {
      return { value: JSON.parse(row.json), updatedAt: row.updated_at, stale: true, source, error: err?.message }
    }
    return { value: null, updatedAt: null, stale: true, source, error: err?.message }
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

const HOUR = 3600
const DAY = 24 * HOUR

// ---------------------------------------------------------------------------
// Yahoo K 線（收盤價序列）
// ---------------------------------------------------------------------------
export interface ClosePoint {
  t: string // ISO 日期
  c: number // 收盤價
}

/** 取得 Yahoo 收盤價序列。range 例：'5y'、'2y'、'1y'；interval：'1d'、'1wk' */
export function getYahooCloses(symbol: string, range: string, interval: '1d' | '1wk', ttl = 30 * 60) {
  return cached<ClosePoint[]>(`yahoo:${symbol}:${range}:${interval}`, ttl, 'Yahoo Finance', async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}`
    const data = await getJson(url)
    const r = data?.chart?.result?.[0]
    if (!r?.timestamp) throw new Error(`Yahoo 無資料 ${symbol}`)
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close || []
    const out: ClosePoint[] = []
    r.timestamp.forEach((ts: number, i: number) => {
      const c = closes[i]
      if (c != null && !isNaN(c)) out.push({ t: new Date(ts * 1000).toISOString(), c })
    })
    // 盤中最新價（meta）補在最後，讓均線比較用到即時價
    const live = r.meta?.regularMarketPrice
    if (live && out.length) out[out.length - 1] = { ...out[out.length - 1], c: live }
    if (!out.length) throw new Error(`Yahoo 無收盤價 ${symbol}`)
    return out
  })
}

export interface OhlcPoint {
  t: string
  c: number // 收盤
  l: number // 盤中最低
  h: number // 盤中最高
}

/** Yahoo 日 K（含盤中高低點），用來判斷「盤中曾跌到 -40%」 */
export function getYahooDaily(symbol: string, range: string, ttl = 15 * 60) {
  return cached<OhlcPoint[]>(`yahoo-ohlc:${symbol}:${range}`, ttl, 'Yahoo Finance', async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
    const data = await getJson(url)
    const r = data?.chart?.result?.[0]
    if (!r?.timestamp) throw new Error(`Yahoo 無資料 ${symbol}`)
    const q = r.indicators?.quote?.[0] || {}
    const out: OhlcPoint[] = []
    r.timestamp.forEach((ts: number, i: number) => {
      const c = q.close?.[i]
      const l = q.low?.[i]
      const h = q.high?.[i]
      if ([c, l, h].every((v) => v != null && Number.isFinite(v) && v > 0)) {
        out.push({ t: new Date(ts * 1000).toISOString(), c, l, h })
      }
    })
    if (!out.length) throw new Error(`Yahoo 無日 K ${symbol}`)
    return out
  })
}

// ---------------------------------------------------------------------------
// 加密貨幣
// ---------------------------------------------------------------------------

/** BTC MVRV（市值 ÷ 已實現市值），近 400 天，每 6 小時更新 */
export function getBtcMvrv() {
  return cached<ClosePoint[]>('coinmetrics:btc:mvrv', 6 * HOUR, 'CoinMetrics', async () => {
    // 從最新往回取 400 筆（不用 start_time，避免時區或日期格式造成空結果）
    const url =
      'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=400&paging_from=end'
    const data = await getJson(url)
    const rows: any[] = data?.data || []
    const out = rows
      .filter((r) => r.CapMVRVCur != null && r.CapMVRVCur !== '')
      .map((r) => ({ t: r.time, c: Number(r.CapMVRVCur) }))
      .filter((p) => Number.isFinite(p.c) && p.c > 0)
      .sort((a, b) => (a.t < b.t ? -1 : 1))
    if (!out.length) throw new Error('CoinMetrics 無 MVRV 資料')
    return out
  })
}

/** 恐懼與貪婪指數，近 30 天 */
export function getFearGreed() {
  return cached<{ value: number; label: string; t: string }[]>(
    'alternative:fng',
    3 * HOUR,
    'alternative.me',
    async () => {
      const data = await getJson('https://api.alternative.me/fng/?limit=30')
      const rows: any[] = data?.data || []
      if (!rows.length) throw new Error('恐懼貪婪指數無資料')
      return rows.map((r) => ({
        value: Number(r.value),
        label: r.value_classification,
        t: new Date(Number(r.timestamp) * 1000).toISOString(),
      }))
    }
  )
}

/** MSTR（Strategy）持有的 BTC 數量 */
export function getMstrBtcHoldings() {
  return cached<number>('coingecko:mstr:holdings', 12 * HOUR, 'CoinGecko', async () => {
    const data = await getJson('https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin')
    const co = (data?.companies || []).find(
      (c: any) => c.symbol?.toUpperCase().startsWith('MSTR') || /strategy|microstrategy/i.test(c.name)
    )
    if (!co?.total_holdings) throw new Error('CoinGecko 找不到 MSTR 持幣資料')
    return Number(co.total_holdings)
  })
}

/** MSTR 稀釋後加權股數（SEC 最新一季財報） */
export function getMstrDilutedShares() {
  return cached<{ shares: number; periodEnd: string; filed: string }>(
    'sec:mstr:diluted',
    DAY,
    'SEC EDGAR',
    async () => {
      // SEC 要求 User-Agent 帶聯絡資訊；這裡用通用名稱
      const data = await getJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0001050446.json', {
        'User-Agent': 'PortfolioDashboard research-bot',
      })
      const g = data?.facts?.['us-gaap'] || {}
      const series: any[] =
        g.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares ||
        g.WeightedAverageNumberOfSharesOutstandingBasic?.units?.shares ||
        []
      // 只取單季（約 90 天）的數字，避免拿到年度平均
      const quarterly = series.filter((s) => {
        if (!s.start || !s.end) return false
        const days = (new Date(s.end).getTime() - new Date(s.start).getTime()) / (DAY * 1000)
        return days > 80 && days < 100
      })
      const latest = quarterly.sort((a, b) => (a.end < b.end ? -1 : 1)).pop()
      if (!latest) throw new Error('SEC 找不到 MSTR 股數')
      return { shares: Number(latest.val), periodEnd: latest.end, filed: latest.filed }
    }
  )
}

// ---------------------------------------------------------------------------
// 總體經濟
// ---------------------------------------------------------------------------

/** 美國失業率（月），近 3 年，給 Sahm 指標用 */
export function getUsUnemployment() {
  return cached<{ ym: string; rate: number }[]>('bls:unemployment', 12 * HOUR, 'BLS', async () => {
    const data = await getJson('https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000')
    const rows: any[] = data?.Results?.series?.[0]?.data || []
    const out = rows
      .filter((r) => /^M\d\d$/.test(r.period) && r.period !== 'M13')
      .map((r) => ({ ym: `${r.year}-${r.period.slice(1)}`, rate: Number(r.value) }))
      .filter((r) => !isNaN(r.rate))
      .sort((a, b) => (a.ym < b.ym ? -1 : 1))
    if (out.length < 15) throw new Error('BLS 失業率資料不足')
    return out
  })
}

/** 台積電月營收（近 26 個月），算年增率 */
export function getTsmcMonthlyRevenue() {
  return cached<{ ym: string; revenue: number }[]>('finmind:2330:revenue', 12 * HOUR, 'FinMind', async () => {
    const start = new Date(Date.now() - 800 * DAY * 1000).toISOString().slice(0, 10)
    const data = await getJson(
      `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=2330&start_date=${start}`
    )
    const rows: any[] = data?.data || []
    const out = rows
      .map((r) => ({
        ym: `${r.revenue_year}-${String(r.revenue_month).padStart(2, '0')}`,
        revenue: Number(r.revenue),
      }))
      .sort((a, b) => (a.ym < b.ym ? -1 : 1))
    if (out.length < 13) throw new Error('台積電月營收資料不足')
    return out
  })
}
