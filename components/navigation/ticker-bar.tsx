'use client'

import React from 'react'
import { Menu, PanelLeft, RefreshCw } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { valuePortfolio } from '@/lib/valuation'
import { cn } from '@/lib/utils'

interface TickerBarProps {
  title: string
  actions?: React.ReactNode
  onRefresh: () => void
  refreshing: boolean
}

/** 44px 精簡即時列：頁名、總淨值、各持倉現價（相對平均成本 %）、刷新、手機 ☰ */
export function TickerBar({ title, actions, onRefresh, refreshing }: TickerBarProps) {
  const { toggleSidebar } = useSidebar()
  const { categories, displayCurrency, exchangeRate } = usePortfolioStore()
  const v = valuePortfolio(categories, displayCurrency, exchangeRate)
  const sym = displayCurrency === 'USD' ? '$' : 'NT$'
  const quotes = categories
    .flatMap((c) => c.assets)
    .filter((a) => a.currentPrice != null && a.quantity > 0)
    .map((a) => ({
      symbol: a.symbol,
      price: a.currentPrice as number,
      pct: a.costPerUnit > 0 ? ((a.currentPrice as number) / a.costPerUnit - 1) * 100 : null,
    }))

  return (
    <header className="sticky top-0 z-40 flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur">
      {/* 電腦寬度：收合側邊欄 */}
      <button
        onClick={toggleSidebar}
        className="hidden size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
        aria-label="收合／展開側邊欄"
        title="收合／展開側邊欄（Ctrl+B）"
      >
        <PanelLeft className="size-4" />
      </button>
      <h1 className="min-w-0 truncate text-sm font-bold text-foreground">{title}</h1>

      <div className="hidden shrink-0 items-baseline gap-1.5 border-l border-border pl-3 sm:flex">
        <span className="text-[11px] text-muted-foreground">淨值</span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {sym} {Math.round(v.totalValue).toLocaleString()}
        </span>
        <span className={cn('font-mono text-xs tabular-nums', v.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive')}>
          {v.unrealizedPnlPercent >= 0 ? '+' : ''}
          {v.unrealizedPnlPercent.toFixed(2)}%
        </span>
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-4 overflow-x-auto border-l border-border pl-3 [scrollbar-width:none] lg:flex">
        {quotes.map((q) => (
          <span key={q.symbol} className="flex shrink-0 items-baseline gap-1.5 text-xs" title="現價／相對平均成本">
            <span className="font-mono font-semibold text-foreground">{q.symbol}</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            {q.pct != null && (
              <span className={cn('font-mono tabular-nums', q.pct >= 0 ? 'text-success' : 'text-destructive')}>
                {q.pct >= 0 ? '+' : ''}
                {q.pct.toFixed(1)}%
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex h-7 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
          title="重新讀取資料庫並更新全部持倉報價"
          aria-label="刷新資料與報價"
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          <span className="hidden sm:inline">刷新</span>
        </button>
        {/* 手機寬度：右上角 ☰ 開啟側邊欄 */}
        <button
          onClick={toggleSidebar}
          className="flex size-8 items-center justify-center rounded border border-border text-foreground md:hidden"
          aria-label="開啟選單"
        >
          <Menu className="size-4" />
        </button>
      </div>
    </header>
  )
}
