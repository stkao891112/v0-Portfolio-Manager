'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Coins, ArrowRight, TrendingUp, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

type MarketPhase = 'BULL_EARLY' | 'BULL_MID' | 'BULL_LATE' | 'BEAR_WAITING'

export function BtcMstrDashboard() {
  const [phase, setPhase] = useState<MarketPhase>('BULL_MID')
  const [btcPrice, setBtcPrice] = useState(0)
  const [mstrPrice, setMstrPrice] = useState(0)
  const [mstrBtcRatio, setMstrBtcRatio] = useState(0)
  const [holdings, setHoldings] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const phaseMatrix: Record<MarketPhase, { label: string; desc: string; mstrRatio: number; btcRatio: number }> = {
    BULL_EARLY: {
      label: '牛市初期',
      desc: '市場剛突破底部，MSTR 高槓桿溢價空間大',
      mstrRatio: 0.7,
      btcRatio: 0.3,
    },
    BULL_MID: {
      label: '牛市中期',
      desc: '行情主升段，維持 MSTR 與 BTC 平衡配置',
      mstrRatio: 0.5,
      btcRatio: 0.5,
    },
    BULL_LATE: {
      label: '牛市後期',
      desc: '溢價高企且狂熱，逐步將獲利轉回 BTC 防守',
      mstrRatio: 0.3,
      btcRatio: 0.7,
    },
    BEAR_WAITING: {
      label: '熊市等待期',
      desc: '去槓桿避險，全部持有 BTC，0% MSTR',
      mstrRatio: 0.0,
      btcRatio: 1.0,
    },
  }

  const loadStrategyData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/strategy/btc')
      if (res.ok) {
        const data = await res.json()
        if (data.currentPhase) setPhase(data.currentPhase)
        if (data.btcQuote) setBtcPrice(data.btcQuote.price)
        if (data.mstrQuote) setMstrPrice(data.mstrQuote.price)
        if (data.mstrBtcRatio) setMstrBtcRatio(data.mstrBtcRatio)
        if (data.holdings) setHoldings(data.holdings)
      }
    } catch (err) {
      console.error('Failed to load BTC/MSTR strategy:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStrategyData()
  }, [])

  const handleSelectPhase = async (newPhase: MarketPhase) => {
    setPhase(newPhase)
    try {
      const res = await fetch('/api/strategy/btc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: newPhase }),
      })
      if (res.ok) {
        toast.success(`市場階段已更新為【${phaseMatrix[newPhase].label}】，建議配比已重新計算`)
        loadStrategyData()
      }
    } catch (err) {
      toast.error('無法儲存市場階段設定')
    }
  }

  const currentConfig = phaseMatrix[phase]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Coins className="size-5 text-indigo-400" />
              BTC / MSTR 週期動態輪動策略
            </h2>
            <Badge variant="outline" className="border-indigo-400/50 text-indigo-400">
              佔整體投資資產 25%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            透過比特幣現貨與高槓桿標的（MSTR）在牛熊週期的強弱勢，動態最佳化資產回報與防守。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-1.5">
              <span className="text-muted-foreground mr-1.5">BTC:</span>
              <span className="font-bold text-foreground">
                ${btcPrice > 0 ? btcPrice.toLocaleString() : '88,500'}
              </span>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-1.5">
              <span className="text-muted-foreground mr-1.5">MSTR:</span>
              <span className="font-bold text-foreground">
                ${mstrPrice > 0 ? mstrPrice.toLocaleString() : '380.00'}
              </span>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-1.5">
              <span className="text-muted-foreground mr-1.5">MSTR/BTC 比值:</span>
              <span className="font-bold text-primary">
                {mstrBtcRatio > 0 ? (mstrBtcRatio * 1000).toFixed(4) : '4.2938'}k
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadStrategyData}
            disabled={loading}
            className="size-8 p-0 text-muted-foreground hover:text-foreground"
            title="刷新報價"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Market Phase Switcher */}
      <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
        <CardHeader className="pb-3 border-b border-border/30">
          <CardTitle className="text-base font-semibold text-foreground flex items-center justify-between">
            <span>市場階段手動設定 (Phase Selector)</span>
            <span className="text-xs font-normal text-muted-foreground">點選即可儲存至本機資料庫</span>
          </CardTitle>
          <CardDescription className="text-xs">
            點選市場當前階段，系統將依預設策略自動計算 MSTR 與 BTC 在加密部位內部的建議配置比例。
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(phaseMatrix) as MarketPhase[]).map((pKey) => {
              const p = phaseMatrix[pKey]
              const isSelected = phase === pKey
              return (
                <button
                  key={pKey}
                  onClick={() => handleSelectPhase(pKey)}
                  className={`text-left p-3.5 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? 'border-indigo-500/60 bg-indigo-500/15 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                      : 'border-border/40 bg-background/50 hover:border-border/80 hover:bg-background/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-sm font-bold ${isSelected ? 'text-indigo-300' : 'text-foreground'}`}>
                      {p.label}
                    </span>
                    {isSelected && <CheckCircle2 className="size-4 text-indigo-400" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">{p.desc}</p>
                  <div className="flex items-center justify-between text-xs font-mono font-semibold pt-2 border-t border-border/30">
                    <span className="text-indigo-400">MSTR: {p.mstrRatio * 100}%</span>
                    <span className="text-amber-400">BTC: {p.btcRatio * 100}%</span>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Target Allocation Comparison */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-base font-semibold text-foreground">
              當前階段建議配置 ({currentConfig.label})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">MSTR 目標佔比（加密內部）</span>
                <span className="font-mono font-bold text-indigo-400">{currentConfig.mstrRatio * 100}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${currentConfig.mstrRatio * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>整體投資資產佔比：{(0.25 * currentConfig.mstrRatio * 100).toFixed(1)}%</span>
                {holdings && (
                  <span className="font-mono">
                    實際持倉: {holdings.actualMstrRatio}% ({holdings.mstrDeviation > 0 ? '+' : ''}{holdings.mstrDeviation}%)
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">BTC 目標佔比（加密內部）</span>
                <span className="font-mono font-bold text-amber-400">{currentConfig.btcRatio * 100}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${currentConfig.btcRatio * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>整體投資資產佔比：{(0.25 * currentConfig.btcRatio * 100).toFixed(1)}%</span>
                {holdings && (
                  <span className="font-mono">
                    實際持倉: {holdings.actualBtcRatio}% ({holdings.btcDeviation > 0 ? '+' : ''}{holdings.btcDeviation}%)
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Strategy Rules & Notes */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-base font-semibold text-foreground">
              策略執行守則與邊界
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs text-muted-foreground leading-relaxed">
            <div className="flex items-start gap-2">
              <div className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span>
                <strong>預設配置目標：</strong>整體投資組合固定配置 25% 於加密資產，其餘 75% 嚴格分配於台股、美股核心與現金儲備。
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span>
                <strong>不自行新增其他槓桿標的：</strong>不追蹤或新增 MSTU、CONL、SOL 或其他合約與多倍槓桿產品。
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span>
                <strong>人工作業確認：</strong>週期切換產生的再平衡換算僅供決策參考，需由使用者手動執行與記帳確認。
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
