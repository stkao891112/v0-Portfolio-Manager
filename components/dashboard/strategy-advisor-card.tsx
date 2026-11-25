'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import {
  ShieldCheck,
  AlertTriangle,
  Siren,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  CalendarClock,
  Settings2,
  Info,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react'
import { Category } from '@/lib/portfolio-types'
import { convertCurrency, assetMarketValue } from '@/lib/valuation'
import { MarketRadarMetrics, MarketRadarResponse, RADAR_SYMBOLS } from '@/lib/market-radar'
import {
  evaluateStrategy,
  HoldingInput,
  Light,
  SLEEVES,
  STAGE_INFO,
  STAGE_THRESHOLDS,
} from '@/lib/strategy-rules'

const LS_AGGRESSIVE = 'strategyAdvisor.aggressive'
const LS_BACKTEST_URL = 'strategyAdvisor.backtestUrl'
const LS_TABLE_OPEN = 'strategyAdvisor.tableOpen'
const DEFAULT_BACKTEST_URL = 'http://localhost:5173'

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 私密視窗等情況忽略 */
  }
}

const LIGHT_STYLE: Record<Light, { dot: string; border: string; bg: string; text: string; label: string }> = {
  red: { dot: 'bg-rose-500', border: 'border-rose-500/40', bg: 'bg-rose-500/10', text: 'text-rose-500 dark:text-rose-400', label: '紅燈' },
  orange: { dot: 'bg-amber-500', border: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', label: '橘燈' },
  green: { dot: 'bg-emerald-500', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-600 dark:text-emerald-400', label: '綠燈' },
  info: { dot: 'bg-sky-500', border: 'border-sky-500/30', bg: 'bg-sky-500/5', text: 'text-sky-600 dark:text-sky-400', label: '選配' },
  unknown: { dot: 'bg-muted-foreground', border: 'border-border/40', bg: 'bg-muted/20', text: 'text-muted-foreground', label: '暫缺' },
}

const LIGHT_ICON: Record<Light, React.ComponentType<{ className?: string }>> = {
  red: Siren,
  orange: AlertTriangle,
  green: CheckCircle2,
  info: Info,
  unknown: HelpCircle,
}

const fmtTwd = (n: number) => `NT$ ${Math.round(n).toLocaleString('en-US')}`
const fmtPct = (n: number | null | undefined, signed = false) =>
  n === null || n === undefined ? '—' : `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%`
const fmtPrice = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2))

interface StrategyAdvisorCardProps {
  categories: Category[]
  exchangeRate: number
  /** 每月定投金額（TWD） */
  monthlyInvestmentAmount?: number
}

export function StrategyAdvisorCard({ categories, exchangeRate, monthlyInvestmentAmount = 20000 }: StrategyAdvisorCardProps) {
  const [today, setToday] = useState<Date | null>(null)
  const [aggressive, setAggressive] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [backtestUrl, setBacktestUrl] = useState(DEFAULT_BACKTEST_URL)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState(DEFAULT_BACKTEST_URL)

  const [radar, setRadar] = useState<MarketRadarResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // 讀取本機偏好（放在 effect 內，避免伺服器端渲染不一致）
  useEffect(() => {
    setToday(new Date())
    setAggressive(lsGet(LS_AGGRESSIVE) === '1')
    setTableOpen(lsGet(LS_TABLE_OPEN) === '1')
    const url = lsGet(LS_BACKTEST_URL)
    if (url) {
      setBacktestUrl(url)
      setUrlDraft(url)
    }
  }, [])

  const loadRadar = useCallback(async (force = false) => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/strategy-radar${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as MarketRadarResponse
      setRadar(data)
      if (force) setToday(new Date())
    } catch (err: any) {
      setFetchError(err?.message || '行情讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRadar(false)
  }, [loadRadar])

  const holdings: HoldingInput[] = useMemo(() => {
    const out: HoldingInput[] = []
    for (const a of categories.flatMap((c) => c.assets)) {
      try {
        out.push({ symbol: a.symbol, valueTwd: convertCurrency(assetMarketValue(a), a.currency, 'TWD', exchangeRate) })
      } catch {
        /* 匯率無效時略過該筆 */
      }
    }
    return out
  }, [categories, exchangeRate])

  const market = useMemo(() => {
    const map: Record<string, MarketRadarMetrics | null> = {}
    for (const r of radar?.results ?? []) map[r.symbol] = r.ok && r.data ? r.data : null
    return map
  }, [radar])

  const result = useMemo(
    () =>
      today
        ? evaluateStrategy({ holdings, market, today, aggressive, monthlyCashTwd: monthlyInvestmentAmount })
        : null,
    [holdings, market, today, aggressive, monthlyInvestmentAmount]
  )

  const toggleAggressive = (v: boolean) => {
    setAggressive(v)
    lsSet(LS_AGGRESSIVE, v ? '1' : '0')
  }
  const toggleTable = () => {
    setTableOpen((o) => {
      lsSet(LS_TABLE_OPEN, o ? '0' : '1')
      return !o
    })
  }
  const saveUrl = () => {
    const v = urlDraft.trim() || DEFAULT_BACKTEST_URL
    setBacktestUrl(v)
    setUrlDraft(v)
    lsSet(LS_BACKTEST_URL, v)
    setEditingUrl(false)
  }

  if (!result) {
    return (
      <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
        <CardContent className="py-6 text-sm text-muted-foreground">策略戰情卡載入中…</CardContent>
      </Card>
    )
  }

  const marketLoaded = !!radar
  const actionable = result.advices.filter((a) => a.light === 'red' || a.light === 'orange')
  const overallStyle = LIGHT_STYLE[result.overall]
  const OverallIcon = result.overall === 'green' ? ShieldCheck : result.overall === 'red' ? Siren : AlertTriangle
  const failed = radar?.results.filter((r) => !r.ok) ?? []

  return (
    <Card className="border-primary/30 bg-card/70 backdrop-blur-xl overflow-hidden" aria-labelledby="advisor-title">
      <CardHeader className="border-b border-border/30 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id="advisor-title" className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            個人投資規則戰情卡
            <span className="hidden sm:inline text-xs font-normal text-muted-foreground">Strategy &amp; Market Advisor</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <a
              href={backtestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
              title={`開啟本機回測系統：${backtestUrl}`}
            >
              <ExternalLink className="size-3.5" />
              回測系統
            </a>
            <button
              type="button"
              onClick={() => setEditingUrl((v) => !v)}
              className="rounded-md border border-border/50 p-1 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
              aria-label="設定回測系統網址"
              title="設定回測系統網址"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        </div>
        {editingUrl && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="backtest-url" className="text-xs text-muted-foreground shrink-0">
              回測系統網址
            </label>
            <input
              id="backtest-url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveUrl()}
              className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2 text-base sm:text-xs font-mono text-foreground"
            />
            <button
              type="button"
              onClick={saveUrl}
              className="h-8 rounded-md bg-primary/20 px-3 text-xs font-semibold text-primary border border-primary/40 hover:bg-primary/30"
            >
              儲存
            </button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* 今日行動總結 */}
        <div className={`rounded-xl border p-4 ${overallStyle.border} ${overallStyle.bg}`} role="status">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${overallStyle.bg} border ${overallStyle.border}`}>
              <OverallIcon className={`size-5 ${overallStyle.text}`} />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">今日行動總結</p>
              <h2 className={`text-base sm:text-lg font-bold leading-snug ${overallStyle.text}`}>
                {result.overall === 'green' ? '目前無觸發警戒，照常執行每月定投' : `今日有 ${actionable.length} 項需要動作`}
              </h2>
              {actionable.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {actionable.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm text-foreground">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${LIGHT_STYLE[a.light].dot}`} />
                      <span className="min-w-0 break-words">{a.title}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!marketLoaded && (
                <p className="text-xs text-muted-foreground">{loading ? '市場位階讀取中，市場類規則稍後顯示…' : fetchError ? `市場位階讀取失敗：${fetchError}` : ''}</p>
              )}
            </div>
          </div>
        </div>

        {/* 階段 / 再平衡倒數 / 積極版 */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">資產階段</span>
              <Badge variant="outline" className="border-primary/40 text-primary text-xs">
                階段 {result.stage}・{result.stageName}
              </Badge>
            </div>
            <div className="font-mono text-lg font-bold text-foreground">{fmtTwd(result.summary.totalTwd)}</div>
            <Progress value={result.progressPct} aria-label="階段進度" />
            <p className="text-xs text-muted-foreground">
              {result.nextThreshold
                ? `距 ${result.nextThreshold / 10000} 萬（下一階段）還差 ${fmtTwd(result.nextThreshold - result.summary.totalTwd)}`
                : `已達 ${STAGE_THRESHOLDS.stage3 / 10000} 萬以上（${STAGE_INFO[3].range}）`}
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">半年再平衡</span>
              <CalendarClock className={`size-4 ${result.schedule.inWindow ? 'text-amber-500' : 'text-emerald-500'}`} />
            </div>
            <div className="font-mono text-lg font-bold text-foreground">
              {result.schedule.daysUntilNext === 0 ? '今天' : `${result.schedule.daysUntilNext} 天`}
            </div>
            <p className="text-xs text-muted-foreground">
              下次：{result.schedule.nextDate.replace(/-/g, '/')}
              {result.schedule.inWindow ? '・目前在 ±7 天視窗內' : '・照常定投即可'}
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="aggressive-switch" className="text-xs text-muted-foreground">
                SOXL 配置
              </label>
              <Switch
                id="aggressive-switch"
                checked={aggressive}
                onCheckedChange={toggleAggressive}
                aria-label="切換起步超跌積極版"
              />
            </div>
            <div className="text-lg font-bold text-foreground">
              {aggressive ? '積極版 SOXL 25%' : '標準版 SOXL 15%'}
            </div>
            <p className="text-xs text-muted-foreground">
              {aggressive && !result.aggressiveApplied
                ? '積極版只在階段 1 生效，目前已改用本階段配置'
                : aggressive
                ? '起步超跌積極版：SOXL 25% + QQQM 15%'
                : 'T5 標準：SOXL 15% + QQQM 25%'}
            </p>
          </div>
        </div>

        {/* 目標 vs 實際權重 */}
        <div className="rounded-lg border border-border/40 bg-background/50 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            目標配置 vs 實際權重（分母＝總投資資產
            {result.summary.otherTwd > 0 ? `，規則外持倉 ${fmtPct(result.summary.otherPct)}` : ''}）
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            {SLEEVES.filter((s) => result.target[s] > 0 || result.summary.sleeves[s].valueTwd > 0).map((s) => {
              const sw = result.summary.sleeves[s]
              const diff = sw.weightPct - sw.targetPct
              return (
                <div key={s} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-foreground">{s}</span>
                  <span className="font-mono text-muted-foreground">
                    {sw.weightPct.toFixed(1)}/{sw.targetPct}%
                    <span className={`ml-1 ${Math.abs(diff) < 2 ? 'text-emerald-500' : diff > 0 ? 'text-amber-500' : 'text-rose-500'}`}>
                      {diff > 0 ? '+' : ''}
                      {diff.toFixed(1)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 行動建議清單 */}
        <ul className="grid gap-2 md:grid-cols-2" aria-label="行動建議清單">
          {result.advices.map((a) => {
            const st = LIGHT_STYLE[a.light]
            const Icon = LIGHT_ICON[a.light]
            return (
              <li key={a.id} className={`rounded-lg border p-3 ${st.border} ${st.bg}`}>
                <div className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${st.text}`} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.bg} ${st.text} border ${st.border}`}>{st.label}</span>
                      <span className="text-sm font-semibold text-foreground break-words">{a.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">{a.detail}</p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {/* 再平衡差額表（只在 ±7 天視窗內出現） */}
        {result.rebalancePlan && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="mb-2 text-sm font-semibold text-foreground">半年再平衡差額（優先用當月新資金補低配，不夠再賣超標）</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/40">
                    <th className="py-1.5 text-left font-medium">標的</th>
                    <th className="py-1.5 text-right font-medium">目前</th>
                    <th className="py-1.5 text-right font-medium">目標</th>
                    <th className="py-1.5 text-right font-medium">差額</th>
                    <th className="py-1.5 text-right font-medium">新資金補</th>
                    <th className="py-1.5 text-right font-medium">賣出</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.rebalancePlan.rows.map((r) => (
                    <tr key={r.sleeve} className="border-b border-border/20">
                      <td className="py-1.5 font-sans font-semibold text-foreground">{r.sleeve}</td>
                      <td className="py-1.5 text-right">{fmtTwd(r.currentTwd)}</td>
                      <td className="py-1.5 text-right">{fmtTwd(r.targetTwd)}</td>
                      <td className={`py-1.5 text-right ${r.diffTwd >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {r.diffTwd >= 0 ? '+' : ''}
                        {fmtTwd(r.diffTwd)}
                      </td>
                      <td className="py-1.5 text-right">{r.buyWithCashTwd > 0 ? fmtTwd(r.buyWithCashTwd) : '—'}</td>
                      <td className="py-1.5 text-right">{r.sellTwd > 0 ? fmtTwd(r.sellTwd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 核心標的位階表 */}
        <div className="rounded-lg border border-border/40 bg-background/50">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <button
              type="button"
              onClick={toggleTable}
              aria-expanded={tableOpen}
              aria-controls="radar-table"
              className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <ChevronDown className={`size-4 shrink-0 transition-transform ${tableOpen ? 'rotate-180' : ''}`} />
              <span className="truncate">核心標的 200MA &amp; 週 RSI 位階表</span>
            </button>
            <button
              type="button"
              onClick={() => loadRadar(true)}
              disabled={loading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              重新整理
            </button>
          </div>
          {tableOpen && (
            <div id="radar-table" className="border-t border-border/30 px-3 pb-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/40">
                      <th className="py-1.5 text-left font-medium">標的</th>
                      <th className="py-1.5 text-right font-medium">現價</th>
                      <th className="py-1.5 text-right font-medium">距高點</th>
                      <th className="py-1.5 text-right font-medium">200MA</th>
                      <th className="py-1.5 text-right font-medium">距 200MA</th>
                      <th className="py-1.5 text-right font-medium">日 RSI</th>
                      <th className="py-1.5 text-right font-medium">週 RSI</th>
                      <th className="py-1.5 text-right font-medium">日期</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {(radar?.results ?? RADAR_SYMBOLS.map((s) => ({ symbol: s, ok: false, error: loading ? '讀取中' : '尚無資料' }))).map(
                      (r) =>
                        r.ok && r.data ? (
                          <tr key={r.symbol} className="border-b border-border/20">
                            <td className="py-1.5 font-sans font-semibold text-foreground">
                              {r.symbol}
                              {r.data.splitAdjusted && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(已修正拆股)</span>}
                            </td>
                            <td className="py-1.5 text-right">{fmtPrice(r.data.latestPrice)}</td>
                            <td className={`py-1.5 text-right ${r.data.drawdownFromAthPct <= -30 ? 'text-rose-500' : ''}`}>
                              {fmtPct(r.data.drawdownFromAthPct, true)}
                            </td>
                            <td className="py-1.5 text-right">{r.data.ma200 ? fmtPrice(r.data.ma200) : '—'}</td>
                            <td className={`py-1.5 text-right ${r.data.aboveMa200 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {fmtPct(r.data.distanceToMa200Pct, true)}
                            </td>
                            <td className="py-1.5 text-right">{r.data.dailyRsi14?.toFixed(1) ?? '—'}</td>
                            <td
                              className={`py-1.5 text-right ${
                                (r.data.weeklyRsi14 ?? 0) > 75 ? 'text-amber-500 font-bold' : (r.data.weeklyRsi14 ?? 100) < 30 ? 'text-sky-500' : ''
                              }`}
                            >
                              {r.data.weeklyRsi14?.toFixed(1) ?? '—'}
                            </td>
                            <td className="py-1.5 text-right text-muted-foreground">{r.data.latestDate.slice(5)}</td>
                          </tr>
                        ) : (
                          <tr key={r.symbol} className="border-b border-border/20">
                            <td className="py-1.5 font-sans font-semibold text-foreground">{r.symbol}</td>
                            <td colSpan={7} className="py-1.5 text-right font-sans text-muted-foreground">
                              {r.error || '無資料'}
                            </td>
                          </tr>
                        )
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                資料來源 Yahoo Finance 近 2 年日線；週 RSI 只計已收盤完整週；伺服器快取 {radar?.cacheTtlMinutes ?? 20} 分鐘
                {radar ? `・更新於 ${new Date(radar.generatedAt).toLocaleTimeString('zh-TW', { hour12: false })}` : ''}
                {failed.length ? `・${failed.length} 檔讀取失敗` : ''}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
