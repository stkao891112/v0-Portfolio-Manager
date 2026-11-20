'use client'

import React from 'react'
import { LayoutDashboard, PieChart, Crosshair, Coins, Receipt, Settings, Database, Terminal, Search } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { useDbMode, DB_LABEL } from '@/hooks/use-db-mode'
import { NAV_TABS, type NavTab } from '@/lib/nav'

export const NAV_ICONS: Record<NavTab, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  portfolio: PieChart,
  soxl: Crosshair,
  btc: Coins,
  ledger: Receipt,
  settings: Settings,
}

interface AppSidebarProps {
  currentTab: NavTab
  onTabChange: (tab: NavTab) => void
  onOpenCommand: () => void
}

export function AppSidebar({ currentTab, onTabChange, onOpenCommand }: AppSidebarProps) {
  const dbMode = useDbMode()
  const { isMobile, setOpenMobile } = useSidebar()
  // 手機寬度：點了連結或按鈕後自動收回
  const after = (fn: () => void) => () => {
    fn()
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background">
            <Terminal className="size-4 text-primary" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold text-foreground">投資決策終端</p>
            <p className="truncate text-[11px] text-muted-foreground">本機量化決策系統</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={after(onOpenCommand)} tooltip="指令面板（Ctrl+K）" className="text-muted-foreground">
                  <Search />
                  <span>搜尋／指令</span>
                  <kbd className="ml-auto rounded border border-sidebar-border px-1 font-mono text-[10px] group-data-[collapsible=icon]:hidden">
                    Ctrl K
                  </kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>頁面</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_TABS.map((t) => {
                const Icon = NAV_ICONS[t.id]
                return (
                  <SidebarMenuItem key={t.id}>
                    <SidebarMenuButton
                      isActive={currentTab === t.id}
                      tooltip={t.label}
                      onClick={after(() => onTabChange(t.id))}
                      aria-current={currentTab === t.id ? 'page' : undefined}
                    >
                      <Icon />
                      <span>{t.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div
          className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground"
          title={dbMode ? DB_LABEL[dbMode].long : '資料庫連線中'}
        >
          <Database className="size-3.5 shrink-0 text-success" />
          <span className="truncate font-mono group-data-[collapsible=icon]:hidden">
            {dbMode ? DB_LABEL[dbMode].short : '資料庫連線中'}
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
