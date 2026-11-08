'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  ShieldAlert,
  Coins,
  Crosshair,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'
import { Category, Currency } from '@/lib/portfolio-types'

interface OverviewDashboardProps {
  categories: Category[]
  displayCurrency: Currency
  exchangeRate: number
  onNavigateTab: (tab: any) => void
}

export function OverviewDashboard({
  categories,
  displayCurrency,
  exchangeRate,
  onNavigateTab,
}: OverviewDashboardProps) {
  // Calculate aggregate metrics
  let totalCost = 0
  let totalValue = 0

  const allAssets = categories.flatMap((c) => c.assets)

  for (const a of allAssets) {
    const cost = a.quantity * a.costPerUnit
    const price = a.currentPrice || a.costPerUnit
    const value = a.quantity * price

    const costConv =
      a.currency === displayCurrency
        ? cost
        : a.currency === 'USD' && displayCurrency === 'TWD'
        ? cost * exchangeRate
        : cost / exchangeRate

    const valConv =
      a.currency === displayCurrency
        ? value
        : a.currency === 'USD' && displayCurrency === 'TWD'
        ? value * exchangeRate
        : value / exchangeRate

    totalCost += costConv
    totalValue += valConv
  }

  const pnl = totalValue - totalCost
  const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0

  // SOXL Reserve stats
  const soxlCategory = categories.find((c) => c.name.includes('SOXL') || c.name.includes('預備金'))
  const soxlReserveTarget = 10 // 10%
  const soxlActualPercent =
    totalValue > 0 && soxlCategory
      ? (soxlCategory.assets.reduce((sum, a) => {
          const val = a.quantity * (a.currentPrice || a.costPerUnit)
          return sum + (a.currency === displayCurrency ? val : a.currency === 'USD' ? val * exchangeRate : val / exchangeRate)
        }, 0) /
          totalValue) *
        100
      : 0

  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  return (
    <div className="space-y-6">
      {/* Top Banner / Today's Action */}
      <div className="rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-background to-secondary/10 p-5 glow-primary">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10">
                系統今日狀態
              </Badge>
              <span className="text-xs text-muted-foreground">本機行情引擎運作中</span>
            </div>
            <h2 className="text-lg font-bold text-foreground">
              SOXX 處於週期高點觀察區，SOXL 尚未觸發第 1 批次進場條件 (-40%)
            </h2>
            <p className="text-xs text-muted-foreground">
              目前 SOXL 機會預備金累積中（維持現金緩衝），等待深度回撤與確認止跌訊號。
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('soxl')}
            className="flex items-center gap-2 self-start md:self-center rounded-lg bg-primary/20 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/30 border border-primary/40 transition-colors"
          >
            <span>查看 SOXL 狙擊進度</span>
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Value */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">總資產淨值</CardTitle>
            <DollarSign className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {currencySymbol} {Math.round(totalValue).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              總投入成本: {currencySymbol} {Math.round(totalCost).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        {/* Unrealized PnL */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">未實現損益</CardTitle>
            {pnl >= 0 ? (
              <TrendingUp className="size-4 text-emerald-400" />
            ) : (
              <TrendingDown className="size-4 text-rose-400" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {pnl >= 0 ? '+' : ''}
              {currencySymbol} {Math.round(pnl).toLocaleString()}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <Badge
                variant="outline"
                className={`text-xs ${
                  pnl >= 0
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                    : 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                }`}
              >
                {pnlPercent >= 0 ? '+' : ''}
                {pnlPercent.toFixed(2)}%
              </Badge>
              <span className="text-xs text-muted-foreground">歷史報酬</span>
            </div>
          </CardContent>
        </Card>

        {/* SOXL Reserve */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">SOXL 機會預備金</CardTitle>
            <Crosshair className="size-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {soxlActualPercent.toFixed(1)}% / {soxlReserveTarget}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              SOXL 持倉上限: 5% (目前持倉: 0%)
            </p>
          </CardContent>
        </Card>

        {/* Crypto Phase */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">BTC/MSTR 策略</CardTitle>
            <Coins className="size-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">牛市中期</div>
            <p className="text-xs text-muted-foreground mt-1">
              建議配置: MSTR 50% / BTC 50%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout for Strategy Summary & Portfolio Health */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Strategy Signal Center */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="border-b border-border/30 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Crosshair className="size-4 text-primary" />
                策略訊號監控中心
              </CardTitle>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs">
                規則引擎就緒
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">SOXL 熊市狙擊訊號</span>
                <Badge variant="secondary" className="text-xs">等待中 (WAIT)</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                SOXX 週線回撤未達 -40% 門檻。四批次進場條件皆處於等待狀態，無任何強制進場動作。
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">BTC / MSTR 輪動訊號</span>
                <Badge variant="secondary" className="text-xs">維持持倉 (HOLD)</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                目前市場週期設定為【牛市中期】，建議配置各 50%，偏離度在安全範圍（±5%）內。
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">定期投資標的檢查</span>
                <Badge variant="outline" className="border-primary/40 text-primary text-xs">定期投入</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                00662、台積電 (2330)、00935 維持既定定期定額配置；00830 停止定期投入。
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Target Allocation Health */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="border-b border-border/30 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" />
                五大資產目標配置健康度
              </CardTitle>
              <button
                onClick={() => onNavigateTab('portfolio')}
                className="text-xs text-primary hover:underline"
              >
                詳細調整 →
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {categories.map((cat) => {
              const catVal = cat.assets.reduce((sum, a) => {
                const val = a.quantity * (a.currentPrice || a.costPerUnit)
                return sum + (a.currency === displayCurrency ? val : a.currency === 'USD' ? val * exchangeRate : val / exchangeRate)
              }, 0)
              const actualPct = totalValue > 0 ? (catVal / totalValue) * 100 : 0
              const targetPct = cat.targetPercent || cat.assets.reduce((s, a) => s + (a.targetPercent || 0), 0)
              const diff = actualPct - targetPct

              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      實際 {actualPct.toFixed(1)}% / 目標 {targetPct}%
                      <span
                        className={`ml-1.5 ${
                          Math.abs(diff) < 2
                            ? 'text-emerald-400'
                            : diff > 0
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        ({diff > 0 ? '+' : ''}
                        {diff.toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, actualPct)}%`,
                        backgroundColor: cat.color,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
