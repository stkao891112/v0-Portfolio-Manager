'use client'

import React, { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { MIN_OVERRIDE_REASON_LENGTH } from '@/lib/strategies/decision-snapshot'

export interface SoxlTradeRequest {
  mode: 'BUY' | 'SELL'
  tranche?: number
  exitTier?: number | null
  suggestedQuantity: number
  title: string
  /** 違規覆寫：不符合當下規則的項目（有值時必須填理由） */
  overrideViolations?: string[]
}

interface Props {
  request: SoxlTradeRequest | null
  onClose: () => void
  onConfirm: (input: { quantity: number; price: number; overrideReason?: string }) => Promise<void>
  soxlPrice: number
  exchangeRate: number
  holdingQuantity: number
  costBasis: number
  /** 計算權重的總資產（USD） */
  totalPortfolioValueUsd: number
  maxPositionPercent: number
}

/** SOXL 買進／停利賣出的人工確認視窗（取代 window.prompt） */
export function SoxlTradeDialog({
  request,
  onClose,
  onConfirm,
  soxlPrice,
  exchangeRate,
  holdingQuantity,
  costBasis,
  totalPortfolioValueUsd,
  maxPositionPercent,
}: Props) {
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reason, setReason] = useState('')
  const isOverride = (request?.overrideViolations?.length ?? 0) > 0

  useEffect(() => {
    if (request) {
      setQuantity(String(Math.max(0, Math.floor(request.suggestedQuantity))))
      setPrice(soxlPrice > 0 ? String(Number(soxlPrice.toFixed(4))) : '')
      setReason('')
    }
  }, [request, soxlPrice])

  const q = Number(quantity)
  const p = Number(price)
  const isBuy = request?.mode === 'BUY'
  const amountUsd = q > 0 && p > 0 ? q * p : 0
  const amountTwd = amountUsd * exchangeRate
  const qtyAfter = isBuy ? holdingQuantity + (q || 0) : holdingQuantity - (q || 0)
  const weightBefore = totalPortfolioValueUsd > 0 ? ((holdingQuantity * p) / totalPortfolioValueUsd) * 100 : 0
  const weightAfter = totalPortfolioValueUsd > 0 ? ((Math.max(0, qtyAfter) * p) / totalPortfolioValueUsd) * 100 : 0
  const overCap = isBuy && weightAfter > maxPositionPercent + 0.05
  const overSell = !isBuy && q > holdingQuantity
  const estPnl = !isBuy && q > 0 && p > 0 ? (p - costBasis) * q : null

  const error = !(q > 0)
    ? '股數必須大於 0'
    : !(p > 0)
    ? '價格必須大於 0'
    : overSell
    ? `賣出股數超過持有量（${holdingQuantity} 股）`
    : overCap
    ? `買進後占總資產 ${weightAfter.toFixed(2)}%，超過 ${maxPositionPercent}% 上限`
    : isOverride && reason.trim().length < MIN_OVERRIDE_REASON_LENGTH
    ? `違規覆寫需填寫至少 ${MIN_OVERRIDE_REASON_LENGTH} 個字的理由`
    : null

  const submit = async () => {
    if (error) return
    setSubmitting(true)
    try {
      await onConfirm({ quantity: q, price: p, overrideReason: isOverride ? reason.trim() : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="border-border/40 bg-card/95 backdrop-blur-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription className="text-xs">
            確認後才會寫入交易帳本並更新 SOXL 持倉；系統不會自動下單，請另外到券商實際下單。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <Label className="text-xs">{isBuy ? '買進股數' : '賣出股數'}</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">建議 {Math.floor(request?.suggestedQuantity ?? 0)} 股</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">成交單價（USD）</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">現價 ${fmt(soxlPrice)}</p>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">預估金額</span>
            <span className="font-mono font-semibold text-foreground">
              ${fmt(amountUsd)}（約 NT${fmt(amountTwd, 0)}）
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">換算匯率（系統設定）</span>
            <span className="font-mono text-foreground">1 USD = {exchangeRate} TWD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">持股</span>
            <span className="font-mono text-foreground">
              {holdingQuantity} → {Math.max(0, qtyAfter)} 股
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">SOXL 占總資產</span>
            <span className={`font-mono ${overCap ? 'font-bold text-rose-400' : 'text-foreground'}`}>
              {fmt(weightBefore)}% → {fmt(weightAfter)}%（上限 {maxPositionPercent}%）
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              className={`h-full rounded-full ${overCap ? 'bg-rose-500' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, maxPositionPercent > 0 ? (weightAfter / maxPositionPercent) * 100 : 0)}%` }}
            />
          </div>
          {estPnl !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">預估已實現損益</span>
              <span className={`font-mono ${estPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {estPnl >= 0 ? '+' : '-'}${fmt(Math.abs(estPnl))}
              </span>
            </div>
          )}
        </div>

        {isOverride && (
          <div className="space-y-2 rounded-md border border-warning/60 bg-warning/5 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-warning">
              <ShieldAlert className="size-3.5" />
              違規覆寫：這筆交易不符合當下策略規則
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {request?.overrideViolations?.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <Label htmlFor="override-reason" className="text-xs">
              覆寫理由（必填，至少 {MIN_OVERRIDE_REASON_LENGTH} 字，會連同決策快照存檔）
            </Label>
            <textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              placeholder="例如：財報優於預期，判斷提前布局；或個人資金需求需減碼"
            />
            <p className="text-right text-[11px] text-muted-foreground tabular-nums">{reason.trim().length} 字</p>
          </div>
        )}

        {error && (quantity || price || isOverride) && (
          <p className="flex items-center gap-1.5 text-xs text-rose-400">
            <AlertTriangle className="size-3.5" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={!!error || submitting}
            className={isBuy ? '' : 'bg-rose-600 text-white hover:bg-rose-600/90'}
          >
            {submitting ? '寫入中…' : isBuy ? '確認買進並寫入帳本' : '確認賣出並寫入帳本'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
