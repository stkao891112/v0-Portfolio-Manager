import { NextResponse } from 'next/server'
import { YahooFinanceProvider } from '@/lib/market-data/yahoo-provider'
import {
  RADAR_SYMBOLS,
  MarketRadarEntry,
  MarketRadarResponse,
  computeRadarMetrics,
} from '@/lib/market-radar'

/**
 * 市場位階 API（獨立運作，不依賴回測系統後端）
 * GET /api/strategy-radar            → 使用 20 分鐘記憶體快取
 * GET /api/strategy-radar?refresh=1  → 強制重新抓取
 * GET /api/strategy-radar?symbols=BTC-USD,MSTR → 只抓指定標的
 */

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 20 * 60 * 1000
const HISTORY_DAYS = 760 // 約 2 年多一點，確保有 200 日均線與完整週 RSI

const provider = new YahooFinanceProvider()
const cache = new Map<string, { at: number; entry: MarketRadarEntry }>()

async function loadSymbol(symbol: string, force: boolean): Promise<{ entry: MarketRadarEntry; cached: boolean }> {
  const hit = cache.get(symbol)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { entry: hit.entry, cached: true }
  }
  try {
    const end = new Date()
    const start = new Date(end.getTime() - HISTORY_DAYS * 24 * 3600 * 1000)
    const bars = await provider.getHistoricalPrices(symbol, start, end, '1d')
    if (!bars.length) throw new Error('Yahoo Finance 沒有回傳歷史價格')
    const data = computeRadarMetrics(
      symbol,
      bars.map((b) => ({ timestamp: b.timestamp, close: b.close })),
      end
    )
    const entry: MarketRadarEntry = { symbol, ok: true, data }
    cache.set(symbol, { at: Date.now(), entry })
    return { entry, cached: false }
  } catch (err: any) {
    // 抓取失敗時若有舊快取（即使過期）就沿用，避免整張卡變空白
    if (hit?.entry.ok) return { entry: hit.entry, cached: true }
    return { entry: { symbol, ok: false, error: err?.message || String(err) }, cached: false }
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const force = searchParams.get('refresh') === '1'
    const requested = (searchParams.get('symbols') || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    const symbols = requested.length ? requested : [...RADAR_SYMBOLS]

    const settled = await Promise.all(symbols.map((s) => loadSymbol(s, force)))
    const body: MarketRadarResponse = {
      generatedAt: new Date().toISOString(),
      cached: settled.every((s) => s.cached),
      cacheTtlMinutes: CACHE_TTL_MS / 60000,
      results: settled.map((s) => s.entry),
    }
    return NextResponse.json(body)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'unknown error' }, { status: 500 })
  }
}
