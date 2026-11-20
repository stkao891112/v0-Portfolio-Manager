'use client'

import React from 'react'
import { useDbMode, DB_LABEL } from '@/hooks/use-db-mode'
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
  refreshing?: boolean
}

export function MainNav({ currentTab, onTabChange, dbStatus = 'connected', onRefresh, refreshing = false }: MainNavProps) {
  const dbMode = useDbMode()
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

      <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-3 bg-background/95 pl-2 md:static md:bg-transparent md:pl-4 border-l border-border/40">
        <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database className="size-3 text-emerald-400" />
          <span className="text-emerald-400 font-mono" title={dbMode ? DB_LABEL[dbMode].long : ''}>
            {dbMode ? DB_LABEL[dbMode].short : '資料庫'}
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-60"
            title="重新讀取資料庫並更新全部持倉報價"
            aria-label="刷新資料與報價"
          >
            <RefreshCw className={cn('size-3', refreshing && 'animate-spin')} />
            <span>刷新</span>
          </button>
        )}
      </div>
    </nav>
  )
}
