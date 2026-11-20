'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Receipt, Plus, Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePortfolioStore } from '@/lib/portfolio-store'

interface Transaction {
  id: string
  assetId: string | null
  symbol: string
  type: string
  date: string
  quantity: number
  price: number
  fee: number
  currency: string
  exchangeRate: number
  realizedPnl: number | null
  notes: string | null
  strategyTranche: number | null
}

const PAGE_SIZE = 50
const MANUAL = '__manual__'

const TYPE_LABEL: Record<string, string> = {
  BUY: '買進',
  SELL: '賣出',
  DIVIDEND: '股息',
  INITIAL_BALANCE: '初始建倉',
}

export function TradeLedger() {
  const { categories, refreshAll } = usePortfolioStore()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null)

  // New form fields
  const [assetId, setAssetId] = useState<string>(MANUAL)
  const [symbol, setSymbol] = useState('')
  const [type, setType] = useState('BUY')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('0')
  const [currency, setCurrency] = useState('TWD')
  const [notes, setNotes] = useState('')

  const assetOptions = useMemo(
    () =>
      categories.flatMap((c) =>
        c.assets.map((a) => ({ ...a, categoryName: c.name }))
      ),
    [categories]
  )
  const selectedAsset = assetOptions.find((a) => a.id === assetId)

  const fetchTransactions = useCallback(async (offset = 0) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/transactions?limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setTransactions((prev) => (offset === 0 ? data.transactions : [...prev, ...data.transactions]))
      setTotal(data.total ?? 0)
      setHasMore(!!data.hasMore)
    } catch (err: any) {
      toast.error('讀取交易紀錄失敗', { description: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTransactions(0)
  }, [fetchTransactions])

  const resetForm = () => {
    setAssetId(MANUAL)
    setSymbol('')
    setQuantity('')
    setPrice('')
    setFee('0')
    setNotes('')
  }

  const qtyNum = Number(quantity)
  const priceNum = Number(price)
  const feeNum = Number(fee) || 0
  const oversell = type === 'SELL' && selectedAsset ? qtyNum > selectedAsset.quantity + 1e-9 : false
  const formError =
    !(qtyNum > 0)
      ? '數量必須大於 0'
      : !(priceNum > 0)
      ? '價格必須大於 0'
      : feeNum < 0
      ? '手續費不可為負數'
      : oversell
      ? `賣出數量超過目前持有量（${selectedAsset?.quantity}）`
      : type === 'SELL' && !selectedAsset
      ? '賣出必須選擇現有資產（才能計算已實現損益）'
      : !selectedAsset && !symbol.trim()
      ? '請選擇資產或輸入標的代號'
      : null

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formError) {
      toast.error(formError)
      return
    }
    try {
      setSubmitting(true)
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: selectedAsset?.id,
          symbol: selectedAsset?.symbol ?? symbol.trim().toUpperCase(),
          type,
          date,
          quantity: qtyNum,
          price: priceNum,
          fee: feeNum,
          currency: selectedAsset?.currency ?? currency,
          notes,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

      toast.success('交易已寫入帳本', {
        description:
          data.realizedPnl != null
            ? `已實現損益 ${data.realizedPnl >= 0 ? '+' : ''}${Number(data.realizedPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : data.warning,
      })
      setIsOpen(false)
      resetForm()
      await Promise.all([fetchTransactions(0), refreshAll()])
    } catch (err: any) {
      toast.error('寫入交易失敗', { description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    const tx = pendingDelete
    setPendingDelete(null)
    if (!tx) return
    try {
      const res = await fetch(`/api/transactions?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast.success('已刪除（沖銷）這筆交易', { description: data.warning })
      await Promise.all([fetchTransactions(0), refreshAll()])
    } catch (err: any) {
      toast.error('刪除交易失敗', { description: err.message })
    }
  }

  const exportCsv = async () => {
    try {
      // 匯出全部（不受分頁影響）
      const res = await fetch('/api/transactions', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const all: Transaction[] = data.transactions || []
      if (all.length === 0) return
      const headers = ['日期', '標的代號', '交易類型', '數量', '成交單價', '手續費', '幣別', '已實現損益', '備註']
      const rows = all.map((t) => [
        t.date,
        t.symbol,
        t.type,
        t.quantity,
        t.price,
        t.fee,
        t.currency,
        t.realizedPnl ?? '',
        `"${(t.notes || '').replace(/"/g, '""')}"`,
      ])
      const csvContent = '﻿' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error('匯出失敗', { description: err.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            交易紀錄帳本 (Trade Ledger)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            選擇現有資產記錄買賣，系統自動更新持有數量與移動平均成本；賣出會計算已實現損益，超賣會被擋下。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={total === 0}
            className="text-xs gap-1.5 border-border/60"
          >
            <Download className="size-3.5" />
            <span>匯出 CSV</span>
          </Button>

          <Dialog
            open={isOpen}
            onOpenChange={(o) => {
              setIsOpen(o)
              if (!o) resetForm()
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground">
                <Plus className="size-3.5" />
                <span>新增交易紀錄</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border/40 bg-card/95 backdrop-blur-xl sm:max-w-md">
              <DialogHeader>
                <DialogTitle>記錄新交易</DialogTitle>
                <DialogDescription className="text-xs">
                  選擇現有資產時，會一併更新該資產的持有數量與平均成本。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddTransaction} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">資產</Label>
                  <Select value={assetId} onValueChange={setAssetId}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="選擇現有資產" />
                    </SelectTrigger>
                    <SelectContent>
                      {assetOptions.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.symbol}（{a.categoryName}｜持有 {a.quantity.toLocaleString()}）
                        </SelectItem>
                      ))}
                      <SelectItem value={MANUAL}>其他（手動輸入代號，只記錄不更新持倉）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">標的代號</Label>
                    <Input
                      placeholder="e.g. 2330.TW, SOXL"
                      value={selectedAsset ? selectedAsset.symbol : symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      disabled={!!selectedAsset}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">交易類型</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUY">買進 (BUY)</SelectItem>
                        <SelectItem value="SELL">賣出 (SELL)</SelectItem>
                        <SelectItem value="DIVIDEND">股息 (DIVIDEND)</SelectItem>
                        <SelectItem value="INITIAL_BALANCE">初始建倉 (INITIAL)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">交易日期</Label>
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      required
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">幣別</Label>
                    <Select
                      value={selectedAsset ? selectedAsset.currency : currency}
                      onValueChange={setCurrency}
                      disabled={!!selectedAsset}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TWD">新台幣 (TWD)</SelectItem>
                        <SelectItem value="USD">美元 (USD)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{type === 'DIVIDEND' ? '配息股數' : '數量 (股/顆)'}</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      required
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{type === 'DIVIDEND' ? '每股股息' : '成交單價'}</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">手續費</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

                {selectedAsset && (
                  <p className="text-[11px] text-muted-foreground">
                    目前持有 {selectedAsset.quantity.toLocaleString()}，平均成本{' '}
                    {selectedAsset.currency === 'USD' ? '$' : 'NT$'}
                    {selectedAsset.costPerUnit.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </p>
                )}
                {(quantity || price) && formError && <p className="text-[11px] text-destructive">{formError}</p>}

                <div className="space-y-1.5">
                  <Label className="text-xs">備註說明</Label>
                  <Input
                    placeholder="例如：定期定額、第1批狙擊進場"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="text-xs">
                    取消
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submitting || !!formError}
                    className="text-xs bg-primary text-primary-foreground"
                  >
                    {submitting ? '寫入中…' : '確認寫入資料庫'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Transactions Table Card */}
      <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/40 bg-muted/20 text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">日期</th>
                  <th className="p-3 font-medium">標的</th>
                  <th className="p-3 font-medium">類型</th>
                  <th className="p-3 font-medium text-right">數量</th>
                  <th className="p-3 font-medium text-right">單價</th>
                  <th className="p-3 font-medium text-right">總金額</th>
                  <th className="p-3 font-medium text-right">手續費</th>
                  <th className="p-3 font-medium text-right">已實現損益</th>
                  <th className="p-3 font-medium">備註</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 font-mono">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-muted-foreground font-sans">
                      {loading ? '讀取中…' : '目前尚無交易明細紀錄。點選右上角「新增交易紀錄」以開始記錄。'}
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const totalAmount = tx.quantity * tx.price
                    const isBuy = tx.type === 'BUY' || tx.type === 'INITIAL_BALANCE'
                    const cur = tx.currency === 'USD' ? '$' : 'NT$'
                    return (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">{tx.date}</td>
                        <td className="p-3 font-bold text-foreground">
                          {tx.symbol}
                          {!tx.assetId && (
                            <span className="ml-1 font-sans text-[10px] font-normal text-muted-foreground" title="沒有關聯資產，不影響持倉">
                              （未關聯）
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-sans ${
                              isBuy
                                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                                : tx.type === 'DIVIDEND'
                                ? 'border-sky-500/40 text-sky-400 bg-sky-500/10'
                                : 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                            }`}
                          >
                            {TYPE_LABEL[tx.type] ?? tx.type}
                            {tx.strategyTranche ? `・第${tx.strategyTranche}批` : ''}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-foreground">{tx.quantity.toLocaleString()}</td>
                        <td className="p-3 text-right text-foreground">
                          {cur}
                          {tx.price.toLocaleString()}
                        </td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          {cur}
                          {Math.round(totalAmount).toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{tx.fee}</td>
                        <td
                          className={`p-3 text-right ${
                            tx.realizedPnl == null
                              ? 'text-muted-foreground'
                              : tx.realizedPnl >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {tx.realizedPnl == null
                            ? '-'
                            : `${tx.realizedPnl >= 0 ? '+' : ''}${cur}${tx.realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="p-3 font-sans text-muted-foreground max-w-[200px] truncate">{tx.notes || '-'}</td>
                        <td className="p-3">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setPendingDelete(tx)}
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label="刪除（沖銷）這筆交易"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border/30 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              共 {total} 筆，已顯示 {transactions.length} 筆
            </span>
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => void fetchTransactions(transactions.length)}
                className="h-7 text-xs"
              >
                載入更多
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="border-border/50 bg-card/95 backdrop-blur-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>刪除（沖銷）這筆交易？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              {pendingDelete && (
                <>
                  {pendingDelete.date} {pendingDelete.symbol} {TYPE_LABEL[pendingDelete.type] ?? pendingDelete.type}{' '}
                  {pendingDelete.quantity} @ {pendingDelete.price}。
                  {pendingDelete.assetId
                    ? '刪除後會同步回沖該資產的持有數量與平均成本；若之後還有其他交易，平均成本為近似值，請再核對。'
                    : '這筆交易沒有關聯資產，只會刪除紀錄、不影響持倉。'}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
