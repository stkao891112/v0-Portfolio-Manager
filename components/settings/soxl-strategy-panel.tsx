'use client'

import React, { useEffect, useState } from 'react'
import { Crosshair, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SoxlStrategyConfig } from '@/lib/strategies/config'
import { sellPercentToRatio } from '@/lib/strategies/sell-ratio'

interface Form {
  maxPositionPercent: string
  trancheCount: string
  tranchePercent: string
  activateDrawdown: string
  earlyUnlockDrawdowns: string
  intervalWeeks: string
  stopLossMa40Weeks: string
  exitTiers: { gainPercent: string; sellPercent: string }[]
}

const toForm = (c: SoxlStrategyConfig): Form => ({
  maxPositionPercent: String(c.maxPositionPercent),
  trancheCount: String(c.trancheCount),
  tranchePercent: String(Number(c.tranchePercent.toFixed(4))),
  activateDrawdown: String(c.activateDrawdown),
  earlyUnlockDrawdowns: c.earlyUnlockDrawdowns.join(', '),
  intervalWeeks: String(c.intervalWeeks),
  stopLossMa40Weeks: String(c.stopLossMa40Weeks),
  exitTiers: c.exitTiers.map((t) => ({
    gainPercent: String(t.gainPercent),
    sellPercent: String(Number((t.cumulativeSellRatio * 100).toFixed(2))),
  })),
})

const fromForm = (f: Form) => ({
  maxPositionPercent: Number(f.maxPositionPercent),
  trancheCount: Number(f.trancheCount),
  tranchePercent: Number(f.tranchePercent),
  activateDrawdown: Number(f.activateDrawdown),
  earlyUnlockDrawdowns: f.earlyUnlockDrawdowns
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number),
  intervalWeeks: Number(f.intervalWeeks),
  stopLossMa40Weeks: Number(f.stopLossMa40Weeks),
  exitTiers: f.exitTiers.map((t) => ({
    gainPercent: Number(t.gainPercent),
    // 100% 輸入時直接存 1，避免浮點誤差
    cumulativeSellRatio: sellPercentToRatio(t.sellPercent),
  })),
})

/** 前端調參面板：編輯 strategy_settings 的 SOXL 狙擊參數（後端會再完整驗證） */
export function SoxlStrategyPanel() {
  const [form, setForm] = useState<Form | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await fetch('/api/strategy/settings', { cache: 'no-store' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`)
    setForm(toForm(d.config))
    setUpdatedAt(d.updatedAt)
  }

  useEffect(() => {
    load().catch((e) => toast.error('讀取策略參數失敗', { description: e.message }))
  }, [])

  const save = async (reset = false) => {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch('/api/strategy/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { config: fromForm(form) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`)
      setForm(toForm(d.config))
      setUpdatedAt(d.updatedAt)
      toast.success(reset ? '已還原 SOXL 預設參數' : 'SOXL 策略參數已儲存，策略頁會以新參數重新計算')
    } catch (e: any) {
      toast.error('儲存失敗', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const set = (k: keyof Omit<Form, 'exitTiers'>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f))
  const setTier = (i: number, k: 'gainPercent' | 'sellPercent', v: string) =>
    setForm((f) => (f ? { ...f, exitTiers: f.exitTiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) } : f))

  const n = form ? fromForm(form) : null
  const capHint =
    n && n.tranchePercent * n.trancheCount > n.maxPositionPercent + 1e-9
      ? `每批 ${n.tranchePercent}% × ${n.trancheCount} 批 = ${(n.tranchePercent * n.trancheCount).toFixed(2)}%，超過上限 ${n.maxPositionPercent}%`
      : null

  const field = (label: string, k: keyof Omit<Form, 'exitTiers'>, hint?: string, type = 'number') => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} step="any" value={form?.[k] ?? ''} onChange={set(k)} className="h-8 font-mono text-xs tabular-nums" />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <Card className="border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Crosshair className="size-4 text-primary" />
          SOXL 狙擊策略參數
        </CardTitle>
        <CardDescription className="text-xs">
          修改後存入資料庫（strategy_settings），策略頁與首頁立即以新參數判斷；持倉上限會同步到上方「SOXL 持倉上限」。
          {updatedAt && <span className="ml-1 font-mono">最後更新 {updatedAt.slice(0, 16).replace('T', ' ')}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!form ? (
          <p className="text-xs text-muted-foreground">讀取中…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {field('持倉上限（% 總資產）', 'maxPositionPercent')}
              {field('批數', 'trancheCount')}
              {field('每批（% 總資產）', 'tranchePercent')}
              {field('啟動回落門檻（%）', 'activateDrawdown', '負數，例如 -40')}
              {field('提前解鎖門檻（%）', 'earlyUnlockDrawdowns', '逗號分隔，逐批更深', 'text')}
              {field('每隔幾週解鎖下一批', 'intervalWeeks')}
              {field('跌破 40 週線幾週退場', 'stopLossMa40Weeks')}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">分批停利（報酬達到 → 累計賣出比例）</Label>
              <div className="space-y-2">
                {form.exitTiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 text-muted-foreground">第 {i + 1} 階</span>
                    <Input
                      type="number"
                      value={t.gainPercent}
                      onChange={(e) => setTier(i, 'gainPercent', e.target.value)}
                      className="h-8 w-24 font-mono text-xs tabular-nums"
                      aria-label={`第 ${i + 1} 階報酬 %`}
                    />
                    <span className="text-muted-foreground">% →</span>
                    <Input
                      type="number"
                      value={t.sellPercent}
                      onChange={(e) => setTier(i, 'sellPercent', e.target.value)}
                      className="h-8 w-24 font-mono text-xs tabular-nums"
                      aria-label={`第 ${i + 1} 階累計賣出 %`}
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                ))}
              </div>
            </div>

            {capHint && <p className="text-xs text-destructive">{capHint}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => save(true)} disabled={saving} className="gap-1.5 text-xs">
                <RotateCcw className="size-3.5" />
                還原預設
              </Button>
              <Button size="sm" onClick={() => save(false)} disabled={saving || !!capHint} className="gap-1.5 text-xs">
                <Save className="size-3.5" />
                {saving ? '儲存中…' : '儲存策略參數'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
