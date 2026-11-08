'use client'

import React, { useState, useEffect } from 'react'
import { MainNav, NavTab } from '@/components/navigation/main-nav'
import { OverviewDashboard } from '@/components/dashboard/overview-dashboard'
import { PortfolioManager } from '@/components/portfolio-manager'
import { SoxlDashboard } from '@/components/strategies/soxl/soxl-dashboard'
import { BtcMstrDashboard } from '@/components/strategies/btc/btc-mstr-dashboard'
import { TradeLedger } from '@/components/ledger/trade-ledger'
import { SystemSettings } from '@/components/settings/system-settings'
import { ParticleBackground } from '@/components/particle-background'
import { CurrencySettings } from '@/components/currency-settings'
import { AddCategoryDialog } from '@/components/add-category-dialog'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { ShieldCheck, Terminal } from 'lucide-react'

export default function Home() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard')
  const { categories, displayCurrency, exchangeRate, syncWithDatabase, isDbConnected } = usePortfolioStore()

  useEffect(() => {
    syncWithDatabase()
  }, [syncWithDatabase])

  return (
    <div className="relative min-h-screen bg-background text-foreground selection:bg-primary/30">
      <ParticleBackground />

      {/* Top Application Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 glow-primary border border-primary/30">
              <Terminal className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-foreground tracking-tight">
                  Claude 投資決策與資產管理系統
                </h1>
                <span className="hidden sm:inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-primary/10 text-primary border border-primary/30">
                  v1.0 Local
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                本機量化決策終端 • SOXL 狙擊 • BTC/MSTR 輪動 • 資產再平衡
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CurrencySettings />
            {currentTab === 'portfolio' && <AddCategoryDialog />}
          </div>
        </div>

        {/* Global Navigation Bar */}
        <div className="border-t border-border/30 bg-muted/10 px-4">
          <div className="mx-auto max-w-7xl">
            <MainNav
              currentTab={currentTab}
              onTabChange={setCurrentTab}
              onRefresh={() => syncWithDatabase()}
            />
          </div>
        </div>
      </header>

      {/* Main Tab Content */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8">
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
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        <p>
          Claude 投資決策系統 • 所有資料均儲存於本機 SQLite (./data/portfolio.db) • 決策規則經程式明確判定，絕無隨機臆測
        </p>
      </footer>
    </div>
  )
}
