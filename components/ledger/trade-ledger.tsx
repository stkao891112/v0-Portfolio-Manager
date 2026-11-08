'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Receipt, Plus, Download, RefreshCw, ArrowUpRight, ArrowDownLeft } from 'lucide-react'

interface Transaction {
  id: string
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
}

export function TradeLedger() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  // New form fields
  const [symbol, setSymbol] = useState('')
  const [type, setType] = useState('BUY')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('0')
  const [currency, setCurrency] = useState('TWD')
  const [notes, setNotes] = useState('')

  const fetchTransactions = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/transactions')
      const data = await res.json()
      if (data.transactions) {
        setTransactions(data.transactions)
      }
    } catch (err) {
      console.error('Failed to load transactions:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [])

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol || !quantity || !price) return

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          type,
          date,
          quantity: Number(quantity),
          price: Number(price),
          fee: Number(fee) || 0,
          currency,
          notes,
        }),
      })

      if (res.ok) {
        setIsOpen(false)
        setSymbol('')
        setQuantity('')
        setPrice('')
        setFee('0')
        setNotes('')
        fetchTransactions()
      }
    } catch (err) {
      console.error('Failed to save transaction:', err)
    }
  }

  const exportCsv = () => {
    if (transactions.length === 0) return
    const headers = ['日期', '標的代號', '交易類型', '數量', '成交單價', '手續費', '幣別', '備註']
    const rows = transactions.map((t) => [
      t.date,
      t.symbol,
      t.type,
      t.quantity,
      t.price,
      t.fee,
      t.currency,
      `"${t.notes || ''}"`,
    ])
    const csvContent = '﻿' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
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
            記錄每筆買進、賣出與初始資產，嚴謹維護加權平均成本與會計損益。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={transactions.length === 0}
            className="text-xs gap-1.5 border-border/60"
          >
            <Download className="size-3.5" />
            <span>匯出 CSV</span>
          </Button>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground">
                <Plus className="size-3.5" />
                <span>新增交易紀錄</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border/40 bg-card/95 backdrop-blur-xl sm:max-w-md">
              <DialogHeader>
                <DialogTitle>記錄新交易</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddTransaction} className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">標的代號</Label>
                    <Input
                      placeholder="e.g. 2330.TW, SOXL"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      required
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
                    <Select value={currency} onValueChange={setCurrency}>
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
                    <Label className="text-xs">數量 (股/顆)</Label>
                    <Input
                      type="number"
                      step="any"
                      placeholder="0"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      required
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">成交單價</Label>
                    <Input
                      type="number"
                      step="any"
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
                      placeholder="0"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

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
                  <Button type="submit" size="sm" className="text-xs bg-primary text-primary-foreground">
                    確認寫入資料庫
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
                  <th className="p-3 font-medium">備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 font-mono">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground font-sans">
                      目前尚無交易明細紀錄。點選右上角「新增交易紀錄」以開始記錄。
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const total = tx.quantity * tx.price
                    const isBuy = tx.type === 'BUY' || tx.type === 'INITIAL_BALANCE'
                    return (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">{tx.date}</td>
                        <td className="p-3 font-bold text-foreground">{tx.symbol}</td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-sans ${
                              isBuy
                                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                                : 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                            }`}
                          >
                            {tx.type}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-foreground">{tx.quantity.toLocaleString()}</td>
                        <td className="p-3 text-right text-foreground">
                          {tx.currency === 'USD' ? '$' : 'NT$'}
                          {tx.price.toLocaleString()}
                        </td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          {tx.currency === 'USD' ? '$' : 'NT$'}
                          {Math.round(total).toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{tx.fee}</td>
                        <td className="p-3 font-sans text-muted-foreground max-w-[200px] truncate">
                          {tx.notes || '-'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
