'use client'

import React, { useEffect, useState } from 'react'
import { History, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DecisionSnapshot } from '@/lib/strategies/decision-snapshot'

interface SignalRow {
  id: string
  signalType: string
  symbol: string
  price: number
  triggerCondition: string
  recommendedAction: string
  status: string
  createdAt: string
  snapshot: DecisionSnapshot | null
}

const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d }))

/** 決策歷史：每次人工確認時的策略快照，違規覆寫會標示並顯示理由 */
export function DecisionHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<SignalRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/strategy/signals?limit=20', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
        if (alive) setRows(d.signals ?? [])
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [refreshKey])

  return (
    <Card className="border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="size-4 text-primary" />
          決策歷史與當下快照
          <span className="text-[11px] font-normal text-muted-foreground">（最近 20 筆，點開看當時系統怎麼說）</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {error && <p className="p-4 text-xs text-destructive">讀取失敗：{error}</p>}
        {!error && rows === null && <p className="p-4 text-xs text-muted-foreground">讀取中…</p>}
        {rows?.length === 0 && <p className="p-4 text-xs text-muted-foreground">尚無人工確認的決策紀錄。</p>}
        <ul className="divide-y divide-border">
          {rows?.map((r) => {
            const s = r.snapshot
            const overridden = r.status === 'OVERRIDDEN'
            const isOpen = open === r.id
            return (
              <li key={r.id} className="text-xs">
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
                  aria-expanded={isOpen}
                >
                  <span className="w-[86px] shrink-0 font-mono text-muted-foreground tabular-nums">{r.createdAt.slice(0, 10)}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      overridden ? 'border-warning/60 text-warning' : 'border-success/50 text-success'
                    )}
                  >
                    {overridden ? '違規覆寫' : '依規則'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.recommendedAction}</span>
                  <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="space-y-2 bg-background/60 px-4 pb-3 pt-1">
                    <p className="text-muted-foreground">{r.triggerCondition}</p>
                    {s ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                        <div>
                          <dt className="text-[11px] text-muted-foreground">當下訊號</dt>
                          <dd className="text-foreground">{s.signal?.title ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">SOXX 回落</dt>
                          <dd className="font-mono tabular-nums">{fmt(s.soxxDrawdown, 1)}%</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">SOXL 價格／成本</dt>
                          <dd className="font-mono tabular-nums">
                            ${fmt(s.soxlPrice)}／${fmt(s.soxlCostBasis)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-muted-foreground">占總資產（上限）</dt>
                          <dd className="font-mono tabular-nums">
                            {fmt(s.soxlWeightPercent, 1)}%（{fmt(s.maxWeightPercent, 1)}%）
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">這筆紀錄建立於快照功能上線前，沒有當下情境。</p>
                    )}
                    {s?.override.isOverride && (
                      <div className="rounded border border-warning/50 p-2">
                        <p className="text-[11px] text-warning">違反：{s.override.violations.join('；')}</p>
                        <p className="text-foreground">理由：{s.override.reason}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
