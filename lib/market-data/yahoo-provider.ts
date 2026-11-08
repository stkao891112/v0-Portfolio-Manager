import { MarketDataProvider, Quote, PriceBar } from './provider-interface'

export class YahooFinanceProvider implements MarketDataProvider {
  name = 'YahooFinance'

  private normalizeSymbol(symbol: string): string {
    const s = symbol.trim().toUpperCase()
    if (s === 'BTC') return 'BTC-USD'
    if (s === '2330' || s === '2330.TW') return '2330.TW'
    if (s === '00662' || s === '00662.TW') return '00662.TW'
    if (s === '00935' || s === '00935.TW') return '00935.TW'
    if (s === '00830' || s === '00830.TW') return '00830.TW'
    return s
  }

  async getQuote(symbol: string): Promise<Quote> {
    const norm = this.normalizeSymbol(symbol)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(norm)}?interval=1d&range=1d`

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          Accept: 'application/json',
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        throw new Error(`Yahoo API HTTP ${res.status} for ${norm}`)
      }

      const data = await res.json()
      const result = data?.chart?.result?.[0]
      if (!result) {
        throw new Error(`No chart data returned for ${norm}`)
      }

      const meta = result.meta
      const price = meta.regularMarketPrice ?? meta.previousClose ?? 0
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price
      const change = price - prevClose
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0
      const volume = meta.regularMarketVolume ?? 0
      const timestamp = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString()

      return {
        symbol,
        price,
        change,
        changePercent,
        volume,
        timestamp,
        isStale: false,
        source: this.name,
      }
    } catch (err: any) {
      console.warn(`[YahooFinanceProvider] Failed to fetch quote for ${symbol}:`, err.message)
      throw err
    }
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const results: Record<string, Quote> = {}
    await Promise.allSettled(
      symbols.map(async (s) => {
        try {
          const q = await this.getQuote(s)
          results[s] = q
        } catch (e) {
          // Individual failure handled by caller
        }
      })
    )
    return results
  }

  async getHistoricalPrices(
    symbol: string,
    start: Date,
    end: Date,
    interval: '1d' | '1wk' = '1wk'
  ): Promise<PriceBar[]> {
    const norm = this.normalizeSymbol(symbol)
    const period1 = Math.floor(start.getTime() / 1000)
    const period2 = Math.floor(end.getTime() / 1000)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      norm
    )}?period1=${period1}&period2=${period2}&interval=${interval}&includeAdjustedClose=true`

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          Accept: 'application/json',
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        throw new Error(`Yahoo API HTTP ${res.status} for ${norm}`)
      }

      const data = await res.json()
      const result = data?.chart?.result?.[0]
      if (!result || !result.timestamp) {
        return []
      }

      const timestamps: number[] = result.timestamp
      const quote = result.indicators?.quote?.[0] || {}
      const adjclose = result.indicators?.adjclose?.[0]?.adjclose || quote.close || []

      const bars: PriceBar[] = []
      const now = new Date()

      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i]
        const barDate = new Date(t * 1000)
        const open = quote.open?.[i]
        const high = quote.high?.[i]
        const low = quote.low?.[i]
        const close = adjclose?.[i] ?? quote.close?.[i]
        const volume = quote.volume?.[i] ?? 0

        // Skip null or missing bars
        if (open === null || close === null || close === undefined || isNaN(close)) {
          continue
        }

        // Determine if this weekly bar is officially closed
        // For weekly bars: if the bar is within the current week, it is unconfirmed (isClosed = false)
        const isCurrentWeek =
          interval === '1wk' && now.getTime() - barDate.getTime() < 7 * 24 * 3600 * 1000

        bars.push({
          timestamp: barDate.toISOString(),
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume: Number(volume),
          isClosed: !isCurrentWeek,
        })
      }

      return bars
    } catch (err: any) {
      console.warn(`[YahooFinanceProvider] Failed to fetch historical bars for ${symbol}:`, err.message)
      return []
    }
  }
}
