'use client'

import React from 'react'
import useSWR from 'swr'

// 首頁的策略摘要直接讀兩個策略頁的即時結論（每分鐘更新），不再寫死文字
const swrFetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null))
const SIGNAL_BADGE: Record<string, string> = {
  BUY_CANDIDATE: '可加碼',
  MANUAL_REVIEW_REQUIRED: '需人工判斷',
  SELL_CANDIDATE: '停利減碼',
  WARNING: '注意／不買',
  HOLD: '持有中',
  WAIT: '等待中',
  DATA_STALE: '資料過期',
}
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
import { valuePortfolio } from '@/lib/valuation'
import { QuoteStatus } from '@/components/quote-status'
import { StrategyAdvisorCard } from './strategy-advisor-card'

interface Decision {
  level: 'action' | 'warn' | 'ok'
  title: string
  detail: string
  tab: string
  cta: string
}

const BANNER_STYLE = {
  action: { label: '需要行動', border: 'border-primary/60', text: 'text-primary', icon: Crosshair },
  warn: { label: '注意', border: 'border-warning/60', text: 'text-warning', icon: AlertTriangle },
  ok: { label: '正常', border: 'border-success/50', text: 'text-success', icon: CheckCircle2 },
} as const

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
  const { data: soxl } = useSWR('/api/strategy/soxl', swrFetcher, { refreshInterval: 60_000 })
  const { data: btc } = useSWR('/api/strategy/btc', swrFetcher, { refreshInterval: 60_000 })
  const soxlSignal = soxl?.strategyState?.activeSignal
  const btcMain = btc?.allocation?.decisions?.find((d: any) => d.light !== 'gray') ?? btc?.allocation?.decisions?.[0]
  // 共用估值口徑（與資產配置頁、SOXL 策略權重分母一致）
  const valuation = valuePortfolio(categories, displayCurrency, exchangeRate)
  const totalCost = valuation.totalCost
  const totalValue = valuation.totalValue
  const pnl = valuation.unrealizedPnl
  const pnlPercent = valuation.unrealizedPnlPercent

  // SOXL Reserve stats（上限與目標來自後端策略參數，預設 10%）
  const soxlCategory = categories.find((c) => c.name.includes('SOXL') || c.name.includes('預備金'))
  const soxlMaxPercent: number = soxl?.config?.maxPositionPercent ?? soxl?.strategyState?.maxAllowedWeightPercent ?? 10
  const soxlReserveTarget = soxlCategory?.targetPercent ?? soxlMaxPercent
  const soxlActualPercent =
    totalValue > 0 && soxlCategory ? ((valuation.categoryValues[soxlCategory.id] ?? 0) / totalValue) * 100 : 0

  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  // 主決策排序：行動（買／賣）> 警示（需人工、資料過期、配置偏離 > 5%）> 一切正常
  const actions: Decision[] = []
  if (soxlSignal) {
    const t = soxlSignal.type as string
    const level: Decision['level'] =
      t === 'BUY_CANDIDATE' || t === 'SELL_CANDIDATE' ? 'action' : t === 'HOLD' || t === 'WAIT' ? 'ok' : 'warn'
    actions.push({
      level,
      title: `SOXL：${soxlSignal.title}`,
      detail: soxlSignal.suggestedAction ?? soxlSignal.reason ?? '',
      tab: 'soxl',
      cta: '查看 SOXL 狙擊進度',
    })
  }
  if (btcMain) {
    const light = btcMain.light as string
    actions.push({
      level: light === 'green' || light === 'red' ? 'action' : light === 'yellow' ? 'warn' : 'ok',
      title: `BTC／MSTR：${btcMain.title}`,
      detail: btcMain.detail ?? '',
      tab: 'btc',
      cta: '查看輪動建議',
    })
  }
  for (const cat of categories) {
    const actualPct = totalValue > 0 ? ((valuation.categoryValues[cat.id] ?? 0) / totalValue) * 100 : 0
    const targetPct = cat.targetPercent || cat.assets.reduce((s, a) => s + (a.targetPercent || 0), 0)
    const diff = actualPct - targetPct
    if (targetPct > 0 && Math.abs(diff) >= 5) {
      actions.push({
        level: 'warn',
        title: `${cat.name} 偏離目標 ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`,
        detail: `實際 ${actualPct.toFixed(1)}%／目標 ${targetPct}%，建議檢視再平衡試算。`,
        tab: 'portfolio',
        cta: '前往再平衡',
      })
    }
  }
  const rank = { action: 0, warn: 1, ok: 2 } as const
  const sorted = [...actions].sort((a, b) => rank[a.level] - rank[b.level])
  const mainDecision: Decision =
    sorted[0] ??
    ({
      level: 'ok',
      title: soxl || btc ? '今日無需行動，維持既定配置' : '正在讀取策略狀態…',
      detail: '',
      tab: 'portfolio',
      cta: '檢視資產配置',
    } as Decision)
  const otherActions = sorted.slice(1).filter((a) => a.level !== 'ok')

  return (
    <div className="space-y-6">
      {/* 個人投資規則戰情卡：市場位階 × 真實持倉 × 投資紀律 */}
      <StrategyAdvisorCard categories={categories} exchangeRate={exchangeRate} />

      {/* 全域主決策橫幅：一眼看懂今日最重要的行動訊號 */}
      {(() => {
        const s = BANNER_STYLE[mainDecision.level]
        const Icon = s.icon
        return (
          <section
            aria-label="今日主決策"
            className={`rounded-md border bg-card p-4 ${s.border}`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${s.border} ${s.text}`}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${s.border} ${s.text}`}>
                      今日主決策・{s.label}
                    </span>
                    {otherActions.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">另有 {otherActions.length} 項待注意</span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold leading-snug text-foreground">{mainDecision.title}</h2>
                  {mainDecision.detail && <p className="text-xs text-muted-foreground">{mainDecision.detail}</p>}
                  {otherActions.length > 0 && (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
                      {otherActions.map((a) => (
                        <li key={a.title}>
                          <button onClick={() => onNavigateTab(a.tab)} className="hover:text-foreground hover:underline">
                            • {a.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button
                onClick={() => onNavigateTab(mainDecision.tab)}
                className="flex shrink-0 items-center gap-2 self-start rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent md:self-center"
              >
                <span>{mainDecision.cta}</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          </section>
        )
      })()}

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
              SOXL 持倉上限 {soxlMaxPercent}%（目前持倉 {(soxl?.strategyState?.soxlPortfolioWeightPercent ?? 0).toFixed(1)}%）
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
            <div className="text-2xl font-bold text-foreground">{btc?.cycle?.phaseInfo?.label ?? '讀取中'}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {btc?.allocation
                ? `週期分數 ${Math.round(btc.cycle.score)}｜建議 MSTR ${Math.round(btc.allocation.targetMstrShare)}% / BTC ${Math.round(btc.allocation.targetBtcShare)}%`
                : ''}
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
                <Badge variant="secondary" className="text-xs">
                  {soxlSignal ? SIGNAL_BADGE[soxlSignal.type] ?? soxlSignal.type : '讀取中'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {soxlSignal ? `${soxlSignal.title}。${soxlSignal.reason}` : ''}
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">BTC / MSTR 輪動訊號</span>
                <Badge variant="secondary" className="text-xs">{btc?.cycle?.phaseInfo?.label ?? '讀取中'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {btcMain ? `${btcMain.title}。${btcMain.detail}` : ''}
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
            <QuoteStatus />
            {categories.map((cat) => {
              const catVal = valuation.categoryValues[cat.id] ?? 0
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
