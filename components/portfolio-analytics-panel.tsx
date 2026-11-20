'use client'

import { useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Gauge, Cpu, Bitcoin, CalendarPlus, Grid3x3, RefreshCw } from 'lucide-react'

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

interface Suggestion {
  assetId: string
  symbol: string
  name: string
  targetPercent: number
  currentValue: number
  suggestedBuyAmount: number
  postValue: number
  postWeightPercent: number
}

interface CorrelationMatrix {
  symbols: string[]
  window: number
  matrix: Array<Array<number | null>>
}

interface AnalyticsResponse {
  updatedAt: string
  monthlyRebalance: {
    monthlyInvestmentAmount: number
    displayCurrency: 'TWD' | 'USD'
    totalCurrentValue: number
    projectedTotal: number
    suggestions: Suggestion[]
  }
  riskMetrics: { effectiveLeverage: number; techSemiExposurePercent: number; cryptoExposurePercent: number }
  correlation60d: CorrelationMatrix
  correlation90d: CorrelationMatrix
}

/** 相關係數 → 熱力表底色（正 = 紅、負 = 藍，強度越大越深） */
export function correlationCellStyle(v: number | null): CSSProperties {
  if (v == null || !Number.isFinite(v)) return {}
  const a = Math.min(1, Math.abs(v))
  const alpha = 0.08 + a * 0.62
  return { backgroundColor: v >= 0 ? `rgba(244, 63, 94, ${alpha})` : `rgba(56, 189, 248, ${alpha})` }
}

/** 資產配置頁：全投組風險指標、每月新資金再平衡試算、相關性矩陣 */
export function PortfolioAnalyticsPanel() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<AnalyticsResponse>('/api/portfolio/analytics', fetcher, {
    revalidateOnFocus: false,
  })
  const [corrWindow, setCorrWindow] = useState<'60D' | '90D'>('60D')

  if (isLoading) {
    return <div className="py-6 text-center text-xs text-muted-foreground">正在計算全投組量化指標…</div>
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center gap-3 py-6 text-xs text-rose-400">
        量化指標讀取失敗：{error?.message}
        <Button size="sm" variant="outline" onClick={() => mutate()}>
          重試
        </Button>
      </div>
    )
  }

  const { riskMetrics, monthlyRebalance } = data
  const sym = monthlyRebalance.displayCurrency === 'USD' ? '$' : 'NT$'
  const money = (v: number) => `${sym}${Math.round(v).toLocaleString()}`
  const corr = corrWindow === '60D' ? data.correlation60d : data.correlation90d
  const suggestions = [...monthlyRebalance.suggestions].sort((a, b) => b.suggestedBuyAmount - a.suggestedBuyAmount)

  const riskCards = [
    {
      k: '等效 1x 槓桿倍數',
      v: `${riskMetrics.effectiveLeverage.toFixed(2)}x`,
      icon: Gauge,
      warn: riskMetrics.effectiveLeverage >= 1.5,
      note: '各標的權重 × 槓桿倍數加總',
    },
    {
      k: '科技／半導體曝險',
      v: `${riskMetrics.techSemiExposurePercent.toFixed(1)}%`,
      icon: Cpu,
      warn: riskMetrics.techSemiExposurePercent >= 60,
      note: '含槓桿 ETF 等效曝險',
    },
    {
      k: '加密貨幣曝險',
      v: `${riskMetrics.cryptoExposurePercent.toFixed(1)}%`,
      icon: Bitcoin,
      warn: riskMetrics.cryptoExposurePercent >= 35,
      note: 'BTC、MSTR 等加密相關資產',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">全投組量化指標</h2>
        <Button size="sm" variant="ghost" onClick={() => mutate()} className="h-8 gap-1 text-xs" title="重新計算">
          <RefreshCw className={`size-3.5 ${isValidating ? 'animate-spin' : ''}`} />
          重新計算
        </Button>
      </div>

      {/* 全投組風險指標卡 */}
      <div className="grid gap-3 sm:grid-cols-3">
        {riskCards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.k} className={`border ${c.warn ? 'border-amber-400/40 bg-amber-400/5' : 'border-border/40 bg-card/80'}`}>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3.5" />
                  {c.k}
                </div>
                <div className={`font-mono text-2xl font-bold tabular-nums ${c.warn ? 'text-amber-300' : 'text-foreground'}`}>{c.v}</div>
                <div className="text-[11px] text-muted-foreground">{c.note}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 每月新資金免賣股再平衡試算 */}
        <Card className="min-w-0 border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CalendarPlus className="size-4 text-primary" />
              每月新資金免賣股再平衡試算
            </CardTitle>
            <CardDescription className="text-xs">
              本月投入 {money(monthlyRebalance.monthlyInvestmentAmount)}，只用新資金買進低於目標的標的，不賣出任何持股。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {suggestions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">尚無可試算的標的（請先設定目標比例）</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/40">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/40 bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="p-2">標的</th>
                      <th className="p-2 text-right">目前市值</th>
                      <th className="p-2 text-right">建議買入</th>
                      <th className="p-2 text-right">投入後權重</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20 font-mono">
                    {suggestions.map((s) => (
                      <tr key={s.assetId} className="hover:bg-muted/20">
                        <td className="p-2 font-sans">
                          <span className="font-semibold text-foreground">{s.symbol}</span>
                          <span className="ml-1 text-[10px] text-muted-foreground">目標 {s.targetPercent}%</span>
                        </td>
                        <td className="p-2 text-right text-muted-foreground">{money(s.currentValue)}</td>
                        <td className={`p-2 text-right ${s.suggestedBuyAmount > 0 ? 'font-bold text-emerald-400' : 'text-muted-foreground'}`}>
                          {s.suggestedBuyAmount > 0 ? money(s.suggestedBuyAmount) : '—'}
                        </td>
                        <td className="p-2 text-right text-foreground">{s.postWeightPercent.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 相關性矩陣熱力表 */}
        <Card className="min-w-0 border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Grid3x3 className="size-4 text-primary" />
                相關性矩陣（{corrWindow}）
              </CardTitle>
              <div className="inline-flex overflow-hidden rounded-md border border-border/50 text-[11px]">
                {(['60D', '90D'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={corrWindow === w}
                    onClick={() => setCorrWindow(w)}
                    className={`px-2 py-0.5 ${corrWindow === w ? 'bg-primary text-primary-foreground' : 'bg-background/40 text-muted-foreground hover:bg-muted/40'}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <CardDescription className="text-xs">日報酬相關係數；紅＝同向、藍＝反向，顏色越深關聯越強；資料不足顯示「—」。</CardDescription>
          </CardHeader>
          <CardContent>
            {corr.symbols.length < 2 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">至少需要 2 檔非現金標的才能計算相關性</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0.5 text-center font-mono text-[11px]">
                  <thead>
                    <tr>
                      <th className="p-1" />
                      {corr.symbols.map((s) => (
                        <th key={s} className="p-1 font-sans font-semibold text-muted-foreground">
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corr.symbols.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <th className="p-1 text-left font-sans font-semibold text-muted-foreground">{rowSym}</th>
                        {corr.symbols.map((colSym, j) => {
                          const v = corr.matrix[i]?.[j] ?? null
                          return (
                            <td
                              key={colSym}
                              className="rounded p-1 text-foreground"
                              style={correlationCellStyle(v)}
                              title={`${rowSym} × ${colSym}：${v == null ? '資料不足' : v.toFixed(2)}`}
                            >
                              {v == null || !Number.isFinite(v) ? '—' : v.toFixed(2)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
