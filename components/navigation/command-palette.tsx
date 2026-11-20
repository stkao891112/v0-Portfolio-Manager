'use client'

import React, { useEffect } from 'react'
import { RefreshCw, LineChart } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { NAV_TABS, type NavTab } from '@/lib/nav'
import { NAV_ICONS } from './app-sidebar'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (tab: NavTab) => void
  onRefresh: () => void
}

// 標的跳轉：SOXL → 策略頁、BTC/MSTR → 輪動頁，其餘 → 資產配置
function symbolTab(s: string): NavTab {
  const u = s.toUpperCase()
  if (u.includes('SOXL')) return 'soxl'
  if (u.includes('BTC') || u.includes('MSTR')) return 'btc'
  return 'portfolio'
}

/** Ctrl+K 指令面板：切換頁面、跳轉標的、觸發刷新 */
export function CommandPalette({ open, onOpenChange, onNavigate, onRefresh }: CommandPaletteProps) {
  const { categories } = usePortfolioStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="指令面板" description="切換頁面、跳轉標的或刷新報價">
      <CommandInput placeholder="輸入頁面、標的代號或指令…" />
      <CommandList>
        <CommandEmpty>找不到符合的項目</CommandEmpty>
        <CommandGroup heading="頁面">
          {NAV_TABS.map((t) => {
            const Icon = NAV_ICONS[t.id]
            return (
              <CommandItem key={t.id} value={`${t.label} ${t.id} ${t.hint}`} onSelect={() => run(() => onNavigate(t.id))}>
                <Icon />
                <span>{t.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.hint}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
        <CommandGroup heading="標的">
          {categories.flatMap((c) =>
            c.assets.map((a) => (
              <CommandItem
                key={a.id}
                value={`${a.symbol} ${a.name ?? ''} ${c.name}`}
                onSelect={() => run(() => onNavigate(symbolTab(a.symbol)))}
              >
                <LineChart />
                <span className="font-mono">{a.symbol}</span>
                <span className="ml-2 truncate text-xs text-muted-foreground">{a.name ?? c.name}</span>
              </CommandItem>
            ))
          )}
        </CommandGroup>
        <CommandGroup heading="動作">
          <CommandItem value="刷新 報價 refresh 資料庫" onSelect={() => run(onRefresh)}>
            <RefreshCw />
            <span>刷新資料庫與全部報價</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
