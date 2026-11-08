'use client'

import React from 'react'
import {
  LayoutDashboard,
  PieChart,
  Crosshair,
  Coins,
  Receipt,
  Settings,
  Database,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type NavTab = 'dashboard' | 'portfolio' | 'soxl' | 'btc' | 'ledger' | 'settings'

interface MainNavProps {
  currentTab: NavTab
  onTabChange: (tab: NavTab) => void
  dbStatus?: 'connected' | 'connecting' | 'error'
  onRefresh?: () => void
}

export function MainNav({ currentTab, onTabChange, dbStatus = 'connected', onRefresh }: MainNavProps) {
  const navItems = [
    { id: 'dashboard' as NavTab, label: '戰略總覽', icon: LayoutDashboard },
    { id: 'portfolio' as NavTab, label: '資產配置', icon: PieChart },
    { id: 'soxl' as NavTab, label: 'SOXL 熊市狙擊', icon: Crosshair },
    { id: 'btc' as NavTab, label: 'BTC / MSTR 輪動', icon: Coins },
    { id: 'ledger' as NavTab, label: '交易帳本', icon: Receipt },
    { id: 'settings' as NavTab, label: '系統設定', icon: Settings },
  ]

  return (
    <nav className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = currentTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap',
              isActive
                ? 'bg-primary/20 text-primary border border-primary/30 glow-primary shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <Icon className={cn('size-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
            <span>{item.label}</span>
          </button>
        )
      })}

      <div className="ml-auto hidden md:flex items-center gap-3 pl-4 border-l border-border/40">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database className="size-3 text-emerald-400" />
          <span className="text-emerald-400 font-mono">SQLite (Local)</span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            title="手動刷新行情與資料"
          >
            <RefreshCw className="size-3" />
            <span>刷新</span>
          </button>
        )}
      </div>
    </nav>
  )
}
