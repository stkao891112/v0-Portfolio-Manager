import { MarketDataProvider, Quote, PriceBar } from './provider-interface'
import { YahooFinanceProvider } from './yahoo-provider'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'

export class MarketService {
  private provider: MarketDataProvider
  private static instance: MarketService

  constructor(provider?: MarketDataProvider) {
    this.provider = provider || new YahooFinanceProvider()
  }

  static getInstance(): MarketService {
    if (!MarketService.instance) {
      MarketService.instance = new MarketService()
    }
    return MarketService.instance
  }

  async getQuote(symbol: string, maxAgeSeconds = 60): Promise<Quote> {
    ensureTablesExist()
    const sym = symbol.toUpperCase()

    // 1. Check local SQLite cache
    const cached = sqlite.prepare('SELECT * FROM market_prices WHERE symbol = ?').get(sym) as any

    if (cached) {
      const cachedTime = new Date(cached.timestamp).getTime()
      const ageSeconds = (Date.now() - cachedTime) / 1000

      if (ageSeconds < maxAgeSeconds && cached.is_stale === 0) {
        return {
          symbol: sym,
          price: cached.price,
          change: cached.change_24h || 0,
          changePercent: 0,
          volume: cached.volume || 0,
          timestamp: cached.timestamp,
          isStale: false,
          source: 'SQLiteCache',
        }
      }
    }

    // 2. Fetch fresh from provider
    try {
      const fresh = await this.provider.getQuote(sym)
      const now = new Date().toISOString()

      // Save to SQLite market_prices
      sqlite.prepare(`
        INSERT INTO market_prices (id, symbol, price, change_24h, volume, is_stale, timestamp)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          price = excluded.price,
          change_24h = excluded.change_24h,
          volume = excluded.volume,
          is_stale = 0,
          timestamp = excluded.timestamp
      `).run(sym, sym, fresh.price, fresh.change, fresh.volume, now)

      // Also update assets table currentPrice
      sqlite.prepare(`
        UPDATE assets
        SET current_price = ?, price_updated_at = ?, updated_at = ?
        WHERE symbol = ?
      `).run(fresh.price, now, now, sym)

      return fresh
    } catch (err) {
      // 3. Fallback: if cached exists, return as stale
      if (cached) {
        return {
          symbol: sym,
          price: cached.price,
          change: cached.change_24h || 0,
          changePercent: 0,
          volume: cached.volume || 0,
          timestamp: cached.timestamp,
          isStale: true,
          source: 'StaleCacheFallback',
        }
      }
      throw err
    }
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const results: Record<string, Quote> = {}
    await Promise.allSettled(
      symbols.map(async (s) => {
        try {
          results[s] = await this.getQuote(s)
        } catch (e) {
          // Handled individually
        }
      })
    )
    return results
  }

  async getWeeklyBars(symbol: string, lookbackWeeks = 104): Promise<PriceBar[]> {
    ensureTablesExist()
    const sym = symbol.toUpperCase()
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - lookbackWeeks * 7)

    return this.provider.getHistoricalPrices(sym, startDate, endDate, '1wk')
  }
}

export const marketService = MarketService.getInstance()
