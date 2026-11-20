// 頁面分頁定義與 URL 同步（?tab=xxx），支援重新整理與上一頁
export type NavTab = 'dashboard' | 'portfolio' | 'soxl' | 'btc' | 'ledger' | 'settings'

export const NAV_TABS: { id: NavTab; label: string; hint: string }[] = [
  { id: 'dashboard', label: '戰略總覽', hint: '今日主決策與資產健康度' },
  { id: 'portfolio', label: '資產配置', hint: '分類、持倉、量化指標' },
  { id: 'soxl', label: 'SOXL 熊市狙擊', hint: '分批進場與停利' },
  { id: 'btc', label: 'BTC / MSTR 輪動', hint: '週期分數與輪動建議' },
  { id: 'ledger', label: '交易帳本', hint: '交易紀錄、搜尋與彙總' },
  { id: 'settings', label: '系統設定', hint: '策略參數與資料庫' },
]

export function parseTab(value: string | null | undefined): NavTab {
  return NAV_TABS.some((t) => t.id === value) ? (value as NavTab) : 'dashboard'
}

export function tabHref(tab: NavTab): string {
  return tab === 'dashboard' ? '/' : `/?tab=${tab}`
}
