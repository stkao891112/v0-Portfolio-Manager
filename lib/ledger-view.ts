// 交易帳本前端檢視：搜尋、篩選、排序與彙總（純函式，方便測試）
export interface LedgerRow {
  id: string
  symbol: string
  type: string
  date: string
  quantity: number
  price: number
  fee: number
  currency: string
  realizedPnl: number | null
  notes: string | null
}

export type LedgerSortKey = 'date' | 'symbol' | 'amount' | 'realizedPnl'
export interface LedgerFilter {
  search?: string
  symbol?: string // 'ALL' 或代號
  type?: string // 'ALL' 或 BUY/SELL/DIVIDEND/INITIAL_BALANCE
  sortKey?: LedgerSortKey
  sortDir?: 'asc' | 'desc'
}

export interface LedgerTotals {
  currency: string
  count: number
  buyAmount: number
  sellAmount: number
  fees: number
  realizedPnl: number
}

const amountOf = (r: LedgerRow) => r.quantity * r.price

export function filterAndSortLedger<T extends LedgerRow>(rows: T[], f: LedgerFilter = {}): T[] {
  const q = (f.search ?? '').trim().toLowerCase()
  const out = rows.filter((r) => {
    if (f.symbol && f.symbol !== 'ALL' && r.symbol !== f.symbol) return false
    if (f.type && f.type !== 'ALL' && r.type !== f.type) return false
    if (q && !`${r.symbol} ${r.notes ?? ''} ${r.date}`.toLowerCase().includes(q)) return false
    return true
  })
  const key = f.sortKey ?? 'date'
  const dir = f.sortDir === 'asc' ? 1 : -1
  const val = (r: T): number | string =>
    key === 'date' ? r.date : key === 'symbol' ? r.symbol : key === 'amount' ? amountOf(r) : r.realizedPnl ?? -Infinity
  return [...out].sort((a, b) => {
    // 依已實現損益排序時，沒有損益（null）的列不論升降冪都固定排最後
    if (key === 'realizedPnl') {
      const na = a.realizedPnl == null
      const nb = b.realizedPnl == null
      if (na || nb) return na === nb ? 0 : na ? 1 : -1
    }
    const va = val(a)
    const vb = val(b)
    if (va === vb) return 0
    return (va > vb ? 1 : -1) * dir
  })
}

/** 帶正負號的金額：+$123 / -$123 / -NT$123（負號放在幣別符號前） */
export function formatSignedMoney(n: number, symbol: string, maximumFractionDigits = 2): string {
  const sign = n >= 0 ? '+' : '-'
  return `${sign}${symbol}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits })}`
}

/** 依幣別分開彙總（不同幣別不直接相加） */
export function summarizeLedger(rows: LedgerRow[]): LedgerTotals[] {
  const map = new Map<string, LedgerTotals>()
  for (const r of rows) {
    const t =
      map.get(r.currency) ??
      { currency: r.currency, count: 0, buyAmount: 0, sellAmount: 0, fees: 0, realizedPnl: 0 }
    t.count += 1
    if (r.type === 'BUY' || r.type === 'INITIAL_BALANCE') t.buyAmount += amountOf(r)
    else if (r.type === 'SELL') t.sellAmount += amountOf(r)
    t.fees += r.fee || 0
    t.realizedPnl += r.realizedPnl ?? 0
    map.set(r.currency, t)
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}
