'use client'

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDbMode, DB_LABEL } from '@/hooks/use-db-mode'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/navigation/app-sidebar'
import { TickerBar } from '@/components/navigation/ticker-bar'
import { CommandPalette } from '@/components/navigation/command-palette'
import { OverviewDashboard } from '@/components/dashboard/overview-dashboard'
import { PortfolioManager } from '@/components/portfolio-manager'
import { SoxlDashboard } from '@/components/strategies/soxl/soxl-dashboard'
import { BtcMstrDashboard } from '@/components/strategies/btc/btc-mstr-dashboard'
import { TradeLedger } from '@/components/ledger/trade-ledger'
import { SystemSettings } from '@/components/settings/system-settings'
import { CurrencySettings } from '@/components/currency-settings'
import { AddCategoryDialog } from '@/components/add-category-dialog'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { NAV_TABS, parseTab, tabHref, type NavTab } from '@/lib/nav'

function HomeInner() {
  const dbMode = useDbMode()
  const router = useRouter()
  const searchParams = useSearchParams()
  // 分頁狀態以 URL ?tab= 為準：支援重新整理與上一頁
  const currentTab = parseTab(searchParams.get('tab'))
  const setCurrentTab = useCallback(
    (tab: NavTab) => {
      if (tab === currentTab) return // 點同分頁時不重複 push，避免多餘的歷史紀錄
      router.push(tabHref(tab))
    },
    [router, currentTab]
  )
  const [commandOpen, setCommandOpen] = useState(false)
  const { categories, displayCurrency, exchangeRate, refreshAll, isSyncing, isRefreshingQuotes } = usePortfolioStore()
  const refresh = useCallback(() => void refreshAll(), [refreshAll])

  // 初始化：讀資料庫 → 更新全部持倉報價
  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const title = NAV_TABS.find((t) => t.id === currentTab)?.label ?? ''

  return (
    <SidebarProvider>
      <AppSidebar currentTab={currentTab} onTabChange={setCurrentTab} onOpenCommand={() => setCommandOpen(true)} />
      <SidebarInset className="min-w-0 bg-background">
        <TickerBar
          title={title}
          onRefresh={refresh}
          refreshing={isSyncing || isRefreshingQuotes}
          actions={
            <>
              <CurrencySettings />
              {currentTab === 'portfolio' && (
                <span className="hidden sm:inline-flex">
                  <AddCategoryDialog />
                </span>
              )}
            </>
          }
        />

        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
          {currentTab === 'dashboard' && (
            <OverviewDashboard
              categories={categories}
              displayCurrency={displayCurrency}
              exchangeRate={exchangeRate}
              onNavigateTab={setCurrentTab}
            />
          )}
          {currentTab === 'portfolio' && <PortfolioManager hideHeader={true} />}
          {currentTab === 'soxl' && <SoxlDashboard />}
          {currentTab === 'btc' && <BtcMstrDashboard />}
          {currentTab === 'ledger' && <TradeLedger />}
          {currentTab === 'settings' && <SystemSettings />}
        </div>

        <footer className="border-t border-border px-4 py-4 text-center text-[11px] text-muted-foreground">
          {dbMode ? DB_LABEL[dbMode].long : '資料庫連線中'} • 決策規則經程式明確判定 • 資料僅供參考，投資有風險，請謹慎評估
        </footer>
      </SidebarInset>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onNavigate={setCurrentTab} onRefresh={refresh} />
    </SidebarProvider>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <HomeInner />
    </Suspense>
  )
}
