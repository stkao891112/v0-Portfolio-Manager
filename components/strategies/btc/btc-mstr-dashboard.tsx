'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Coins, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

type Light = 'green' | 'yellow' | 'red' | 'gray'

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || '讀取失敗')
    return j
  })

const LIGHT_STYLE: Record<Light, { dot: string; text: string; bg: string; label: string }> = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'border-emerald-500/40 bg-emerald-500/10', label: '可加碼／正常' },
  yellow: { dot: 'bg-amber-400', text: 'text-amber-400', bg: 'border-amber-400/40 bg-amber-400/10', label: '觀察／不加碼' },
  red: { dot: 'bg-rose-500', text: 'text-rose-400', bg: 'border-rose-500/40 bg-rose-500/10', label: '減碼' },
  gray: { dot: 'bg-slate-400', text: 'text-slate-300', bg: 'border-slate-400/40 bg-slate-400/10', label: '資料不足' },
}

const fmtUsd = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** 半圓儀表：0 = 底部、100 = 頂部 */
function CycleGauge({ score }: { score: number }) {
  const angle = Math.PI * (1 - score / 100)
  const r = 80
  const cx = 100
  const cy = 95
  const nx = cx + r * Math.cos(angle)
  const ny = cy - r * Math.sin(angle)
  const bands = [
    { from: 0, to: 25, color: '#10b981' },
    { from: 25, to: 50, color: '#84cc16' },
    { from: 50, to: 75, color: '#f59e0b' },
    { from: 75, to: 90, color: '#f97316' },
    { from: 90, to: 100, color: '#f43f5e' },
  ]
  const arc = (a: number, b: number) => {
    const a1 = Math.PI * (1 - a / 100)
    const a2 = Math.PI * (1 - b / 100)
    return `M ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a2)} ${cy - r * Math.sin(a2)}`
  }
  return (
    <svg viewBox="0 0 200 110" className="w-full max-w-[260px]" role="img" aria-label={`週期分數 ${score.toFixed(0)}`}>
      {bands.map((b) => (
        <path key={b.from} d={arc(b.from, b.to)} stroke={b.color} strokeWidth={14} fill="none" />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="currentColor" />
      <text x={20} y={108} fontSize={9} fill="currentColor" opacity={0.6}>底部</text>
      <text x={162} y={108} fontSize={9} fill="currentColor" opacity={0.6}>頂部</text>
    </svg>
  )
}

export function BtcMstrDashboard() {
  const { data, error, isLoading, mutate, isValidating } = useSWR('/api/strategy/btc', fetcher, {
    refreshInterval: 60_000, // 每分鐘自動更新
    revalidateOnFocus: true,
  })

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">正在抓取報價與鏈上指標…</div>
  }
  if (error || !data) {
    return (
      <div className="py-20 text-center text-sm text-rose-400">
        讀取失敗：{error?.message}
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={() => mutate()}>重試</Button>
        </div>
      </div>
    )
  }

  const { prices, cycle, mstr, allocation, charts, sources, holdings } = data
  const overall = LIGHT_STYLE[allocation.overall as Light]
  const anyStale = sources.some((s: any) => s.stale)

  return (
    <div className="space-y-6">
      {/* 標題與即時報價 */}
      <div className="flex flex-col gap-4 border-b border-border/40 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Coins className="size-5 text-indigo-400" />
            加密貨幣儀表板（BTC 12.5%＋MSTR 12.5%）
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            全自動抓取報價與鏈上指標，每分鐘更新。最後更新 {fmtTime(data.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {[
            { k: 'BTC', v: prices.btc, c: prices.btcChangePct },
            { k: 'MSTR', v: prices.mstr, c: prices.mstrChangePct, d: 2 },
          ].map((p) => (
            <div key={p.k} className="rounded-lg border border-border/40 bg-background/50 px-3 py-1.5">
              <span className="mr-1.5 text-muted-foreground">{p.k}</span>
              <span className="font-bold text-foreground">{fmtUsd(p.v, p.d ?? 0)}</span>
              <span className={`ml-1.5 ${p.c >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {p.c >= 0 ? '+' : ''}
                {p.c.toFixed(2)}%
              </span>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => mutate()} className="size-8 p-0" title="立即更新">
            <RefreshCw className={`size-3.5 ${isValidating ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {anyStale && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="size-4" />
          部分資料來源暫時抓不到，正在使用上次的快取，燈號僅供參考。
        </div>
      )}

      {/* 一眼結論 */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">BTC 週期位置</CardTitle>
            <CardDescription className="text-xs">5 個指標加權，0 = 熊市底部、100 = 牛市頂部</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-1 text-foreground">
            <CycleGauge score={cycle.score} />
            <div className="text-4xl font-black tabular-nums">{cycle.score.toFixed(0)}</div>
            <div className="text-sm font-bold text-indigo-300">{cycle.phaseInfo.label}</div>
            <div className="text-center text-xs text-muted-foreground">{cycle.phaseInfo.desc}</div>
          </CardContent>
        </Card>

        <Card className={`border ${overall.bg}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`inline-block size-3 rounded-full ${overall.dot}`} />
              現在該怎麼做
              <Badge variant="outline" className={`ml-1 ${overall.text}`}>{overall.label}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allocation.decisions.map((d: any, i: number) => {
              const s = LIGHT_STYLE[d.light as Light]
              return (
                <div key={i} className="flex gap-3 rounded-lg border border-border/30 bg-background/40 p-3">
                  <span className={`mt-1 inline-block size-2.5 shrink-0 rounded-full ${s.dot}`} />
                  <div>
                    <div className={`text-sm font-bold ${s.text}`}>{d.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{d.detail}</div>
                  </div>
                </div>
              )
            })}

            {/* 目標 vs 實際 */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>加密部位內的 MSTR 比例</span>
                <span className="font-mono">
                  基本 {allocation.baseMstrShare.toFixed(0)}% {allocation.mnavAdjust >= 0 ? '+' : ''}
                  {allocation.mnavAdjust}（mNAV {mstr.mnavLabel}）＝ 目標{' '}
                  <b className="text-indigo-300">{allocation.targetMstrShare.toFixed(0)}%</b>
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-amber-500/70">
                <div className="h-full bg-indigo-500" style={{ width: `${allocation.targetMstrShare}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span className="text-indigo-300">目標 MSTR {allocation.targetMstrShare.toFixed(0)}%</span>
                <span className="text-amber-300">目標 BTC {allocation.targetBtcShare.toFixed(0)}%</span>
              </div>
              {allocation.cryptoValue > 0 && (
                <>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-amber-500/40">
                    <div className="h-full bg-indigo-500/60" style={{ width: `${allocation.actualMstrShare}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>實際 MSTR {allocation.actualMstrShare.toFixed(1)}%</span>
                    <span>加密占總資產 {allocation.cryptoWeight.toFixed(1)}%（目標 25%）</span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 週期指標 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cycle.indicators.map((ind: any) => (
          <Card key={ind.key} className="border-border/40 bg-card/60">
            <CardContent className="space-y-2 p-4">
              <div className="text-xs text-muted-foreground">{ind.label}</div>
              <div className="text-xl font-bold tabular-nums text-foreground">{ind.display}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
                  style={{ width: `${ind.score ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>分數 {ind.score != null ? ind.score.toFixed(0) : '—'}</span>
                <span>權重 {ind.weight}%</span>
              </div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                底部 {ind.bottomHint}；頂部 {ind.topHint}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MSTR 溢價 */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">MSTR 溢價（mNAV）</CardTitle>
          <CardDescription className="text-xs">
            mNAV ＝ MSTR 市值 ÷ 公司持有 BTC 的價值。低於 1.5 偏便宜、高於 2.5 偏貴。市值以 SEC 最新季報稀釋股數估算，未含債務與特別股。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: 'mNAV', v: mstr.mnav != null ? `${mstr.mnav.toFixed(2)} 倍` : '—', s: mstr.mnavLabel },
            { k: '持有 BTC', v: mstr.btcHeld != null ? `${mstr.btcHeld.toLocaleString()} 顆` : '—', s: 'CoinGecko' },
            { k: 'MSTR 市值（估）', v: mstr.marketCap ? `$${(mstr.marketCap / 1e9).toFixed(1)}B` : '—', s: `股數截至 ${mstr.sharesPeriodEnd ?? '—'}` },
            { k: '持幣價值', v: mstr.btcNav ? `$${(mstr.btcNav / 1e9).toFixed(1)}B` : '—', s: '持有 BTC × 即時價' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-border/30 bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">{x.k}</div>
              <div className="text-lg font-bold tabular-nums text-foreground">{x.v}</div>
              <div className="text-[11px] text-muted-foreground">{x.s}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 圖表 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">BTC 週線與 200 週均線（近 3 年）</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={charts.btc}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} width={55} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => fmtUsd(v)} />
                <Line type="monotone" dataKey="price" name="BTC" stroke="#f59e0b" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="ma200w" name="200 週均線" stroke="#6366f1" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">MSTR ÷ BTC 比值（近 1 年，×10⁴）</CardTitle>
            <CardDescription className="text-xs">往上代表 MSTR 跑贏 BTC（槓桿與溢價擴大）</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.ratio}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} width={45} domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="ratio" name="MSTR/BTC" stroke="#818cf8" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 資料來源 */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">資料來源狀態</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((s: any) => (
            <div key={s.name} className="flex items-center justify-between rounded border border-border/30 px-2 py-1.5">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block size-2 rounded-full ${s.stale ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                {s.name}
              </span>
              <span className="text-muted-foreground">{fmtTime(s.updatedAt)}</span>
            </div>
          ))}
          {holdings.totalUsd > 0 && (
            <div className="text-muted-foreground sm:col-span-2 lg:col-span-3">
              總資產約 {fmtUsd(holdings.totalUsd)}（台幣部位以 USD/TWD {prices.usdTwd.toFixed(2)} 換算）
            </div>
          )}
          <div className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-3">
            燈號是依你設定的規則自動計算的參考，不構成投資建議；實際交易請自行判斷。
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
