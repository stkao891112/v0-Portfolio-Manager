import { MarketDataProvider, Quote, PriceBar } from './provider-interface'
import { YahooFinanceProvider } from './yahoo-provider'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { cached, type Sourced } from './external-sources'

/**
 * market_prices.change_24h 欄位統一存「漲跌幅 %」（changePercent）。
 * 舊版有的地方寫金額、有的寫百分比；讀取時一律當百分比，金額由價格回推。
 */
export function quoteFromCacheRow(
  sym: string,
  row: { price: number; change_24h: number | null; volume: number | null; timestamp: string },
  isStale: boolean,
  source: string
): Quote {
  const price = Number(row.price)
  const changePercent = Number(row.change_24h) || 0
  // 現價 = 昨收 × (1 + pct/100) → 漲跌金額 = 現價 × pct / (100 + pct)
  const change = 100 + changePercent !== 0 ? (price * changePercent) / (100 + changePercent) : 0
  return {
    symbol: sym,
    price,
    change,
    changePercent,
    volume: Number(row.volume) || 0,
    timestamp: row.timestamp,
    isStale,
    source,
  }
}

/** 週 K 重抓頻率：30 分鐘（最新一根的收盤價另由即時報價覆蓋） */
const WEEKLY_BARS_TTL_SECONDS = 30 * 60

export class MarketService {
  private provider: MarketDataProvider
  private static instance: MarketService
  /** 同一執行環境內的週 K 記憶體快取（資料庫快取之前的第一層） */
  private weeklyMemo = new Map<string, { at: number; result: Sourced<PriceBar[]> }>()

  constructor(provider?: MarketDataProvider) {
    this.provider = provider || new YahooFinanceProvider()
  }

  static getInstance(): MarketService {
    if (!MarketService.instance) {
      MarketService.instance = new MarketService()
    }
    return MarketService.instance
  }

  getProvider(): MarketDataProvider {
    return this.provider
  }

  async getQuote(symbol: string, maxAgeSeconds = 60): Promise<Quote> {
    await ensureTablesExist()
    const sym = symbol.toUpperCase()

    // 1. Check database cache
    const cachedRow = await sqlite.get<any>('SELECT * FROM market_prices WHERE symbol = ?', [sym])

    if (cachedRow) {
      const ageSeconds = (Date.now() - new Date(cachedRow.timestamp).getTime()) / 1000
      if (ageSeconds < maxAgeSeconds && Number(cachedRow.is_stale) === 0) {
        return quoteFromCacheRow(sym, cachedRow, false, 'SQLiteCache')
      }
    }

    // 2. Fetch fresh from provider
    try {
      const fresh = await this.provider.getQuote(sym)
      const now = new Date().toISOString()

      // 快取存「抓取時間」（判斷要不要重抓）；資產的報價時間存交易所時間
      await sqlite.batch([
        {
          sql: `
            INSERT INTO market_prices (id, symbol, price, change_24h, volume, is_stale, timestamp)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET
              price = excluded.price,
              change_24h = excluded.change_24h,
              volume = excluded.volume,
              is_stale = 0,
              timestamp = excluded.timestamp
          `,
          args: [sym, sym, fresh.price, fresh.changePercent, fresh.volume, now],
        },
        {
          sql: `
            UPDATE assets
            SET current_price = ?, price_updated_at = ?, updated_at = ?
            WHERE UPPER(symbol) = ?
          `,
          args: [fresh.price, fresh.timestamp, now, sym],
        },
      ])

      return { ...fresh, symbol: sym }
    } catch (err) {
      // 3. Fallback: if cached exists, return as stale
      if (cachedRow) {
        return quoteFromCacheRow(sym, cachedRow, true, 'StaleCacheFallback')
      }
      throw err
    }
  }

  /** 批次報價；抓不到的代號放在 errors（不讓單一失敗拖垮整批） */
  async getQuotesDetailed(symbols: string[]): Promise<{ quotes: Record<string, Quote>; errors: Record<string, string> }> {
    const quotes: Record<string, Quote> = {}
    const errors: Record<string, string> = {}
    await Promise.all(
      symbols.map(async (s) => {
        try {
          quotes[s] = await this.getQuote(s)
        } catch (e: any) {
          errors[s] = e?.message || '報價失敗'
        }
      })
    )
    return { quotes, errors }
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    return (await this.getQuotesDetailed(symbols)).quotes
  }

  /**
   * 週 K（含快取）：記憶體 → 資料庫 indicator_cache → Yahoo。
   * 避免策略頁每分鐘輪詢都重打 Yahoo 被限流；重抓失敗時退回舊快取並標示 stale。
   */
  async getWeeklyBarsSourced(symbol: string, lookbackWeeks = 104): Promise<Sourced<PriceBar[]>> {
    await ensureTablesExist()
    const sym = symbol.toUpperCase()
    const key = `weekly:${sym}:${lookbackWeeks}`
    const memo = this.weeklyMemo.get(key)
    if (memo && Date.now() - memo.at < WEEKLY_BARS_TTL_SECONDS * 1000 && !memo.result.stale) {
      return memo.result
    }

    const result = await cached<PriceBar[]>(
      key,
      WEEKLY_BARS_TTL_SECONDS,
      'Yahoo Finance',
      async () => {
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(endDate.getDate() - lookbackWeeks * 7)
        const bars = await this.provider.getHistoricalPrices(sym, startDate, endDate, '1wk')
        if (!bars.length) throw new Error(`Yahoo 無週 K 資料 ${sym}`)
        return bars
      },
      // 週 K 只要 3 天內抓過都可用（週末、連假不會因此鎖死）
      { validitySeconds: 3 * 24 * 3600 }
    )
    if (result.value) this.weeklyMemo.set(key, { at: Date.now(), result })
    return result
  }

  async getWeeklyBars(symbol: string, lookbackWeeks = 104): Promise<PriceBar[]> {
    return (await this.getWeeklyBarsSourced(symbol, lookbackWeeks)).value ?? []
  }
}

export const marketService = MarketService.getInstance()
