export interface Quote {
  symbol: string
  price: number
  change: number
  changePercent: number
  volume: number
  timestamp: string // ISO UTC
  isStale: boolean
  source: string
}

export interface PriceBar {
  timestamp: string // ISO UTC
  open: number
  high: number
  low: number
  close: number
  volume: number
  isClosed: boolean // true = official confirmed closed bar, false = unconfirmed intraday bar
}

export interface MarketDataProvider {
  name: string
  getQuote(symbol: string): Promise<Quote>
  getQuotes(symbols: string[]): Promise<Record<string, Quote>>
  getHistoricalPrices(symbol: string, start: Date, end: Date, interval?: '1d' | '1wk'): Promise<PriceBar[]>
}
