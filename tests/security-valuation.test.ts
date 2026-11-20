import { describe, it, expect } from 'vitest'
import { checkSameOrigin } from '../lib/security/same-origin'
import { valuePortfolio, valueAsset, assetUnitPrice, isCashLikeSymbol, convertCurrency } from '../lib/valuation'
import { mergePortfolioSettings, SettingsValidationError } from '../lib/portfolio-settings'
import { isWithinValidity, monthEndIso } from '../lib/market-data/external-sources'
import { quoteFromCacheRow } from '../lib/market-data/market-service'
import { isValidUuid } from '../lib/ids'

const req = (method: string, headers: Record<string, string>, url = 'http://localhost:3000/api/assets') => ({
  method,
  url,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
})

describe('寫入 API 同源檢查', () => {
  it('GET 一律放行', () => {
    expect(checkSameOrigin(req('GET', { origin: 'https://evil.example' })).ok).toBe(true)
  })
  it('同源 POST 放行', () => {
    expect(checkSameOrigin(req('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' })).ok).toBe(true)
  })
  it('跨站 POST / PUT / DELETE 擋下', () => {
    for (const m of ['POST', 'PUT', 'DELETE']) {
      expect(checkSameOrigin(req(m, { origin: 'https://evil.example', host: 'localhost:3000' })).ok).toBe(false)
    }
  })
  it('Sec-Fetch-Site: cross-site 擋下；Origin: null 擋下', () => {
    expect(checkSameOrigin(req('POST', { 'sec-fetch-site': 'cross-site' })).ok).toBe(false)
    expect(checkSameOrigin(req('POST', { origin: 'null' })).ok).toBe(false)
  })
  it('沒有 Origin 時看 Referer', () => {
    expect(checkSameOrigin(req('DELETE', { referer: 'http://localhost:3000/', host: 'localhost:3000' })).ok).toBe(true)
    expect(checkSameOrigin(req('DELETE', { referer: 'https://evil.example/x', host: 'localhost:3000' })).ok).toBe(false)
  })
  it('反向代理（x-forwarded-host）視為同源', () => {
    expect(
      checkSameOrigin(
        req('POST', { origin: 'https://pm.vercel.app', 'x-forwarded-host': 'pm.vercel.app' }, 'http://internal:3000/api/x')
      ).ok
    ).toBe(true)
  })
  it('完全沒有來源標頭（curl 等非瀏覽器）放行', () => {
    expect(checkSameOrigin(req('POST', {})).ok).toBe(true)
  })
})

describe('共用估值口徑', () => {
  const cats = [
    {
      id: 'tw',
      assets: [
        { symbol: '2330.TW', quantity: 100, costPerUnit: 500, currency: 'TWD', currentPrice: 1000, priceUpdatedAt: '2026-11-20T05:30:00Z' },
        { symbol: '00662.TW', quantity: 100, costPerUnit: 50, currency: 'TWD', currentPrice: null },
      ],
    },
    {
      id: 'us',
      assets: [
        { symbol: 'SOXL', quantity: 10, costPerUnit: 20, currency: 'USD', currentPrice: 30, priceUpdatedAt: '2026-11-19T21:00:00Z' },
        { symbol: 'SOXL_CASH_BUFFER', quantity: 1000, costPerUnit: 1, currency: 'USD' },
      ],
    },
  ]

  it('市價 = currentPrice ?? costPerUnit', () => {
    expect(assetUnitPrice({ currentPrice: 12, costPerUnit: 10 })).toBe(12)
    expect(assetUnitPrice({ currentPrice: null, costPerUnit: 10 })).toBe(10)
    expect(assetUnitPrice({ currentPrice: 0, costPerUnit: 10 })).toBe(10)
  })

  it('總值、成本、未實現損益與各分類值（TWD 顯示，匯率 30）', () => {
    const v = valuePortfolio(cats, 'TWD', 30)
    // 市值：2330 100×1000 + 00662 100×50 + SOXL 10×30×30 + 現金 1000×30
    expect(v.totalValue).toBe(100000 + 5000 + 9000 + 30000)
    expect(v.totalCost).toBe(50000 + 5000 + 6000 + 30000)
    expect(v.unrealizedPnl).toBe(v.totalValue - v.totalCost)
    expect(v.categoryValues.tw).toBe(105000)
    expect(v.latestPriceUpdatedAt).toBe('2026-11-20T05:30:00Z')
    // 有持倉但沒報價的標的會被列出（現金類不算）
    expect(v.assetsWithoutPrice).toEqual(['00662.TW'])
  })

  it('單一資產估值與幣別換算', () => {
    const a = valueAsset(cats[1].assets[0], 'USD', 30)
    expect(a.marketValue).toBe(300)
    expect(a.unrealizedPnlPercent).toBe(50)
    expect(convertCurrency(300, 'TWD', 'USD', 30)).toBe(10)
    expect(isCashLikeSymbol('CASH_FLOW')).toBe(true)
    expect(isCashLikeSymbol('2330.TW')).toBe(false)
  })
})

describe('設定局部更新（Partial Update）', () => {
  const existing = {
    displayCurrency: 'TWD' as const,
    exchangeRate: 32,
    monthlyInvestmentAmount: 50000,
    emergencyFundAmount: 300000,
    soxlReserveTargetPercent: 10,
    soxlMaxPositionPercent: 10,
  }
  it('只改幣別時，其他欄位不被洗回預設值', () => {
    expect(mergePortfolioSettings(existing, { displayCurrency: 'USD' })).toEqual({ ...existing, displayCurrency: 'USD' })
  })
  it('只改匯率', () => {
    expect(mergePortfolioSettings(existing, { exchangeRate: 31.2 }).monthlyInvestmentAmount).toBe(50000)
  })
  it('不合法的值拒絕', () => {
    expect(() => mergePortfolioSettings(existing, { exchangeRate: 0 })).toThrow(SettingsValidationError)
    expect(() => mergePortfolioSettings(existing, { displayCurrency: 'JPY' })).toThrow(SettingsValidationError)
    expect(() => mergePortfolioSettings(existing, { emergencyFundAmount: -1 })).toThrow(SettingsValidationError)
    expect(() => mergePortfolioSettings(existing, { soxlMaxPositionPercent: 150 })).toThrow(SettingsValidationError)
  })
})

describe('資料有效期（Validity Horizon）與報價快取', () => {
  const DAY = 86400
  it('月資料：以觀測月月底起算，75 天內就算重抓失敗也不算過期', () => {
    const observedAt = monthEndIso('2026-10')!
    expect(observedAt.startsWith('2026-10-31')).toBe(true)
    const now = new Date('2026-12-20T00:00:00Z').getTime()
    expect(isWithinValidity({ now, updatedAt: '2026-11-01T00:00:00Z', observedAt, validitySeconds: 75 * DAY })).toBe(true)
    const later = new Date('2027-01-20T00:00:00Z').getTime()
    expect(isWithinValidity({ now: later, updatedAt: '2026-11-01T00:00:00Z', observedAt, validitySeconds: 75 * DAY })).toBe(false)
  })
  it('沒有觀測日時以上次成功抓取時間起算', () => {
    const now = new Date('2026-11-20T03:00:00Z').getTime()
    expect(isWithinValidity({ now, updatedAt: '2026-11-20T01:00:00Z', validitySeconds: 3 * 3600 })).toBe(true)
    expect(isWithinValidity({ now, updatedAt: '2026-11-19T20:00:00Z', validitySeconds: 3 * 3600 })).toBe(false)
  })
  it('讀快取時 changePercent 不再寫死 0；change_24h 視為百分比', () => {
    const q = quoteFromCacheRow('SOXL', { price: 110, change_24h: 10, volume: 5, timestamp: 't' }, false, 'SQLiteCache')
    expect(q.changePercent).toBe(10)
    expect(q.change).toBeCloseTo(10, 10) // 昨收 100 → 漲 10
  })
  it('UUID 檢查', () => {
    expect(isValidUuid('3b241101-e2bb-4255-8caf-4136c566a962')).toBe(true)
    expect(isValidUuid('seed-cat-1')).toBe(false)
    expect(isValidUuid("x'; DROP TABLE")).toBe(false)
  })
})
