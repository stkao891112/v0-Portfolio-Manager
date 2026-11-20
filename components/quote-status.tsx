'use client'

import { RefreshCw, Clock } from 'lucide-react'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { valuePortfolio } from '@/lib/valuation'

function formatTime(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 報價更新時間與「以成本價估值」的標的提示，所有頁面共用 */
export function QuoteStatus({ className = '' }: { className?: string }) {
  const { categories, displayCurrency, exchangeRate, quotesFetchedAt, isRefreshingQuotes, refreshAll } =
    usePortfolioStore()
  const v = valuePortfolio(categories, displayCurrency, exchangeRate)
  const fetched = formatTime(quotesFetchedAt)
  const latest = formatTime(v.latestPriceUpdatedAt)

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="flex items-center gap-1">
        <Clock className="size-3" />
        估值採市價（無報價時以成本價）
        {fetched ? `｜報價更新 ${fetched}` : latest ? `｜最新報價 ${latest}` : '｜尚未取得報價'}
      </span>
      {v.assetsWithoutPrice.length > 0 && (
        <span className="text-warning">以成本估：{v.assetsWithoutPrice.join('、')}</span>
      )}
      <button
        type="button"
        onClick={() => void refreshAll()}
        disabled={isRefreshingQuotes}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        <RefreshCw className={`size-3 ${isRefreshingQuotes ? 'animate-spin' : ''}`} />
        更新報價
      </button>
    </div>
  )
}
