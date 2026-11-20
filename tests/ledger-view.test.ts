import { describe, it, expect } from 'vitest'
import { filterAndSortLedger, summarizeLedger, type LedgerRow } from '@/lib/ledger-view'
import { parseTab, tabHref } from '@/lib/nav'

const rows: LedgerRow[] = [
  { id: '1', symbol: 'SOXL', type: 'BUY', date: '2026-01-02', quantity: 10, price: 20, fee: 1, currency: 'USD', realizedPnl: null, notes: '第1批' },
  { id: '2', symbol: 'SOXL', type: 'SELL', date: '2026-03-01', quantity: 5, price: 30, fee: 1, currency: 'USD', realizedPnl: 50, notes: null },
  { id: '3', symbol: '2330.TW', type: 'BUY', date: '2026-02-01', quantity: 100, price: 1000, fee: 142, currency: 'TWD', realizedPnl: null, notes: '定期定額' },
  { id: '4', symbol: '2330.TW', type: 'DIVIDEND', date: '2026-04-01', quantity: 100, price: 5, fee: 0, currency: 'TWD', realizedPnl: null, notes: null },
]

describe('ledger view', () => {
  it('預設依日期新到舊', () => {
    expect(filterAndSortLedger(rows).map((r) => r.id)).toEqual(['4', '2', '3', '1'])
  })
  it('依標的、類型、關鍵字篩選', () => {
    expect(filterAndSortLedger(rows, { symbol: 'SOXL' }).length).toBe(2)
    expect(filterAndSortLedger(rows, { type: 'BUY' }).map((r) => r.id)).toEqual(['3', '1'])
    expect(filterAndSortLedger(rows, { search: '定期' }).map((r) => r.id)).toEqual(['3'])
    expect(filterAndSortLedger(rows, { symbol: 'ALL', type: 'ALL', search: '  ' }).length).toBe(4)
  })
  it('依金額升冪排序', () => {
    expect(filterAndSortLedger(rows, { sortKey: 'amount', sortDir: 'asc' }).map((r) => r.id)).toEqual(['2', '1', '4', '3'])
  })
  it('依幣別分開彙總，股息不算買賣', () => {
    const [twd, usd] = summarizeLedger(rows)
    expect(twd).toMatchObject({ currency: 'TWD', count: 2, buyAmount: 100000, sellAmount: 0, fees: 142, realizedPnl: 0 })
    expect(usd).toMatchObject({ currency: 'USD', count: 2, buyAmount: 200, sellAmount: 150, fees: 2, realizedPnl: 50 })
  })
})

describe('nav', () => {
  it('未知分頁回到總覽', () => {
    expect(parseTab('ledger')).toBe('ledger')
    expect(parseTab('hack')).toBe('dashboard')
    expect(parseTab(null)).toBe('dashboard')
    expect(tabHref('dashboard')).toBe('/')
    expect(tabHref('btc')).toBe('/?tab=btc')
  })
})
