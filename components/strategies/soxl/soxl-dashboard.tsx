'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Crosshair,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Info,
  RefreshCw,
  BarChart3,
  History,
} from 'lucide-react'
import { toast } from 'sonner'

export function SoxlDashboard() {
  const [cyclePeak, setCyclePeak] = useState(320.0)
  const [currentSoxxPrice, setCurrentSoxxPrice] = useState(230.5)
  const [currentSoxlPrice, setCurrentSoxlPrice] = useState(28.0)
  const [ma10w, setMa10w] = useState<number | null>(null)
  const [ma40w, setMa40w] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)

  // Backtest state
  const [showBacktest, setShowBacktest] = useState(false)
  const [selectedScenario, setSelectedScenario] = useState('bear_2022')
  const [backtestResult, setBacktestResult] = useState<any>(null)
  const [backtestLoading, setBacktestLoading] = useState(false)

  const fetchStrategyData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/strategy/soxl')
      if (res.ok) {
        const data = await res.json()
        setData(data)
        if (data.indicators?.currentPrice) setCurrentSoxxPrice(data.indicators.currentPrice)
        if (data.indicators?.cyclePeak) setCyclePeak(data.indicators.cyclePeak)
        if (data.indicators?.ma10w) setMa10w(data.indicators.ma10w)
        if (data.indicators?.ma40w) setMa40w(data.indicators.ma40w)
        if (data.soxlQuote?.price) setCurrentSoxlPrice(data.soxlQuote.price)
      }
    } catch (err) {
      console.warn('Using offline SOXL strategy defaults', err)
    } finally {
      setLoading(false)
    }
  }

  const runBacktest = async (scenarioId: string) => {
    try {
      setBacktestLoading(true)
      setSelectedScenario(scenarioId)
      const res = await fetch(`/api/backtest?scenarioId=${scenarioId}`)
      if (res.ok) {
        const data = await res.json()
        setBacktestResult(data.result)
      }
    } catch (err) {
      console.error('Backtest error:', err)
    } finally {
      setBacktestLoading(false)
    }
  }

  useEffect(() => {
    fetchStrategyData()
    const id = setInterval(fetchStrategyData, 60_000) // 每分鐘自動更新
    return () => clearInterval(id)
  }, [])

  // Drawdown calculation: Current SOXX Weekly Close / Cycle Peak - 1
  const drawdown =
    data?.indicators?.drawdownPercent ?? (cyclePeak > 0 ? (currentSoxxPrice / cyclePeak - 1) * 100 : 0)

  const handleConfirmTranche = async (trancheId: number, targetPercent: number) => {
    const qty = prompt(`請輸入預計買進 SOXL 股數 (單價約 $${currentSoxlPrice}):`, '50')
    if (!qty) return

    try {
      const res = await fetch('/api/strategy/soxl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'BUY',
          tranche: trancheId,
          quantity: Number(qty),
          price: currentSoxlPrice,
          notes: `SOXL 策略第 ${trancheId} 批次人工確認執行`,
        }),
      })

      if (res.ok) {
        toast.success(`成功確認執行第 ${trancheId} 批次建倉！已寫入交易紀錄帳本`)
        fetchStrategyData()
      } else {
        toast.error('執行失敗')
      }
    } catch (err: any) {
      toast.error(`錯誤: ${err.message}`)
    }
  }

  // 4 批進場狀態：由後端策略引擎計算（含總經判斷、第 4 批需曾跌過 -40%）
  const tranches = ((data?.strategyState?.tranches as any[]) || []).map((t) => ({
    id: t.tranche,
    name: `第 ${t.tranche} 批進場 (${t.allocationPercent}%)`,
    condition: t.triggerCondition,
    status: t.status === 'CANDIDATE' ? 'READY' : t.status === 'EXECUTED' ? 'DONE' : 'WAITING',
  }))
  const signal = data?.strategyState?.activeSignal
  const macro = data?.macro
  const LIGHT: Record<string, string> = {
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    yellow: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    red: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
    gray: 'border-slate-400/40 bg-slate-400/10 text-slate-300',
  }
  const DOT: Record<string, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-rose-500', gray: 'bg-slate-400' }
  // 一眼結論：買進候選 = 綠；警告／停利 = 紅；需人工確認 = 黃；未進入區間 = 灰
  const verdictLight = !signal
    ? 'gray'
    : signal.type === 'BUY_CANDIDATE'
    ? 'green'
    : signal.type === 'WARNING' || signal.type === 'SELL_CANDIDATE'
    ? 'red'
    : signal.type === 'MANUAL_REVIEW_REQUIRED' || signal.type === 'DATA_STALE'
    ? 'yellow'
    : 'gray'
  const verdictText =
    verdictLight === 'green'
      ? '可加碼 SOXL'
      : verdictLight === 'red'
      ? signal?.type === 'SELL_CANDIDATE'
        ? '停利減碼'
        : '不買／注意'
      : verdictLight === 'yellow'
      ? '需人工判斷'
      : '不動作，等待'

  // Exit tiers
  const exitTiers = [
    { tier: '第一批出場', gain: '+80%', action: '賣出目前持倉的 1/3' },
    { tier: '第二批出場', gain: '+150%', action: '再賣出適當數量，累計出場達 2/3' },
    { tier: '第三批出場', gain: '+200%', action: '原則上清空剩餘全部持倉' },
  ]

  const riskRules = [
    { rule: 'SOXL 最大持倉不得超過整體投資資產 10%', pass: true },
    { rule: '禁止使用信貸、融資或合約增加部位', pass: true },
    { rule: '禁止跌破門檻時自動攤平，嚴格依 4 批進場', pass: true },
    { rule: '緊急預備金嚴格隔離，不可動用為 SOXL 機會預備金', pass: true },
    { rule: '盤中暫定訊號不得作為正式週線交易依據', pass: true },
    { rule: '所有買賣必須有人工確認按鈕，系統禁止自動下單', pass: true },
  ]

  return (
    <div className="space-y-6">
      {/* Strategy Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Crosshair className="size-5 text-primary" />
              SOXL 熊市狙擊策略儀表板
            </h2>
            <Badge variant="outline" className="border-primary/50 text-primary">
              半導體週期左側狙擊
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            以 SOXX（半導體大盤）為市場基準判定週期回撤；以 SOXL 為分批交易標的（10% 預備金分 4 批，上限 10%）。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={showBacktest ? 'default' : 'outline'}
            onClick={() => {
              setShowBacktest(!showBacktest)
              if (!backtestResult && !showBacktest) runBacktest('bear_2022')
            }}
            className="text-xs gap-1.5 border-border/50"
          >
            <History className="size-3.5" />
            <span>{showBacktest ? '回到策略監控' : '開啟歷史回測驗證'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={fetchStrategyData}
            disabled={loading}
            className="text-xs gap-1 border-border/50"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            <span>更新行情</span>
          </Button>

          <div className="text-right">
            <span className="text-[11px] text-muted-foreground">SOXX 週期高點</span>
            <div className="font-mono text-sm font-bold text-foreground">${cyclePeak.toFixed(2)}</div>
          </div>
          <div className="text-right pl-3 border-l border-border/40">
            <span className="text-[11px] text-muted-foreground">SOXX 現價 / 回撤</span>
            <div className="font-mono text-sm font-bold text-rose-400">
              ${currentSoxxPrice.toFixed(2)} ({drawdown.toFixed(2)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Historical Backtest Panel */}
      {showBacktest ? (
        <div className="space-y-6">
          <Card className="border-primary/40 bg-card/80 backdrop-blur-xl glow-primary">
            <CardHeader className="pb-3 border-b border-border/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                    <BarChart3 className="size-4 text-primary" />
                    SOXL 熊市狙擊策略歷史回測模擬引擎
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    嚴格考慮 SOXL 3x 每日重置槓桿磨損、滑價 (0.1%) 與交易手續費 (0.1%)，非簡單乘以 3 倍虛構報酬。
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={selectedScenario === 'bear_2022' ? 'default' : 'outline'}
                    onClick={() => runBacktest('bear_2022')}
                    className="text-xs h-7 px-2.5"
                  >
                    2022 半導體熊市
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedScenario === 'covid_2020' ? 'default' : 'outline'}
                    onClick={() => runBacktest('covid_2020')}
                    className="text-xs h-7 px-2.5"
                  >
                    2020 疫情閃崩
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedScenario === 'trade_war_2018' ? 'default' : 'outline'}
                    onClick={() => runBacktest('trade_war_2018')}
                    className="text-xs h-7 px-2.5"
                  >
                    2018 貿易戰
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {backtestLoading ? (
                <div className="text-center py-12 text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="size-4 animate-spin text-primary" />
                  <span>正在計算歷史回測數據...</span>
                </div>
              ) : backtestResult ? (
                <div className="space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg border border-border/40 bg-background/50">
                      <span className="text-[11px] text-muted-foreground">策略總報酬率</span>
                      <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        +{backtestResult.totalReturnPercent}%
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        同期大盤: {backtestResult.benchmarkReturnPercent}%
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-border/40 bg-background/50">
                      <span className="text-[11px] text-muted-foreground">年化報酬率 (CAGR)</span>
                      <div className="text-xl font-bold font-mono text-foreground mt-1">
                        {backtestResult.annualizedReturnPercent}%
                      </div>
                      <span className="text-[10px] text-muted-foreground">期間: {backtestResult.period}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-border/40 bg-background/50">
                      <span className="text-[11px] text-muted-foreground">策略最大回撤 (MDD)</span>
                      <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                        {backtestResult.maxDrawdownPercent}%
                      </div>
                      <span className="text-[10px] text-emerald-400">大幅優於 SOXL 純持有的 -85%</span>
                    </div>

                    <div className="p-3 rounded-lg border border-border/40 bg-background/50">
                      <span className="text-[11px] text-muted-foreground">交易勝率 / 次數</span>
                      <div className="text-xl font-bold font-mono text-primary mt-1">
                        {backtestResult.winRate}% / {backtestResult.tradesCount} 筆
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        平均持有週數: {backtestResult.avgHoldingWeeks} 週
                      </span>
                    </div>
                  </div>

                  {/* Trades List */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-foreground">回測模擬交易明細清單</span>
                    <div className="overflow-x-auto rounded-lg border border-border/40">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-muted/30 text-muted-foreground border-b border-border/40">
                          <tr>
                            <th className="p-2.5">日期</th>
                            <th className="p-2.5">動作</th>
                            <th className="p-2.5 text-right">成交單價</th>
                            <th className="p-2.5 text-right">股數</th>
                            <th className="p-2.5 text-right">報酬率 / 損益</th>
                            <th className="p-2.5 font-sans">觸發理由</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {backtestResult.trades.map((t: any, idx: number) => (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="p-2.5 text-muted-foreground">{t.date}</td>
                              <td className="p-2.5">
                                <Badge
                                  variant="outline"
                                  className={
                                    t.type === 'BUY'
                                      ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                                      : 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                                  }
                                >
                                  {t.type} {t.tranche ? `第${t.tranche}批` : ''}
                                </Badge>
                              </td>
                              <td className="p-2.5 text-right">${t.price.toFixed(2)}</td>
                              <td className="p-2.5 text-right">{t.quantity}</td>
                              <td className="p-2.5 text-right">
                                {t.returnPercent ? (
                                  <span className="text-emerald-400 font-bold">
                                    +{t.returnPercent.toFixed(1)}% (+${Math.round(t.pnl)} USD)
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className="p-2.5 font-sans text-muted-foreground">{t.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* 一眼結論 + 總經判斷 */}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={`border ${LIGHT[verdictLight]}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base text-foreground">
                <span className={`inline-block size-3 rounded-full ${DOT[verdictLight]}`} />
                現在要不要加碼 SOXL？
                <Badge variant="outline" className={LIGHT[verdictLight]}>{verdictText}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="text-sm font-bold text-foreground">{signal?.title}</div>
              <div className="leading-relaxed text-muted-foreground">{signal?.reason}</div>
              <div className="rounded-lg border border-border/30 bg-background/40 p-2.5 leading-relaxed text-foreground">
                {signal?.suggestedAction}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="rounded-lg border border-border/30 bg-background/40 p-2">
                  <div className="text-[11px] text-muted-foreground">本輪高點（自動）</div>
                  <div className="font-mono font-bold text-foreground">${data.cycle?.peak?.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">{data.cycle?.peakDate?.slice(0, 10)}</div>
                </div>
                <div className="rounded-lg border border-border/30 bg-background/40 p-2">
                  <div className="text-[11px] text-muted-foreground">目前回落</div>
                  <div className="font-mono font-bold text-rose-400">{drawdown.toFixed(1)}%</div>
                  <div className="text-[10px] text-muted-foreground">從日收盤高點算</div>
                </div>
                <div className="rounded-lg border border-border/30 bg-background/40 p-2">
                  <div className="text-[11px] text-muted-foreground">盤中最深回落</div>
                  <div className="font-mono font-bold text-foreground">{data.cycle?.maxDrawdownSincePeak?.toFixed(1)}%</div>
                  <div className={`text-[10px] ${data.cycle?.sniperActivatedAt ? 'font-bold text-emerald-400' : 'text-muted-foreground'}`}>
                    {data.cycle?.sniperActivatedAt
                      ? `狙擊期 ${data.cycle.sniperActivatedAt.slice(0, 10)} 啟動`
                      : `距啟動（-40%）還差 ${(data.cycle?.maxDrawdownSincePeak + 40).toFixed(1)} 點`}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {macro && (
            <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base text-foreground">
                  下跌原因判斷
                  <Badge variant="outline" className={LIGHT[macro.light]}>{macro.label}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">{macro.desc}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {macro.checks.map((c: any) => (
                  <div key={c.key} className="rounded-lg border border-border/30 bg-background/40 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`inline-block size-2 rounded-full ${DOT[c.light]}`} />
                      {c.label}
                    </div>
                    <div className="font-mono text-sm font-bold text-foreground">{c.value}</div>
                    <div className="text-[10px] leading-snug text-muted-foreground">{c.note}</div>
                  </div>
                ))}
                <div className="text-[10px] text-muted-foreground sm:col-span-2">
                  資料：{(data.macroSources || []).map((x: any) => `${x.name}${x.stale ? '（過期）' : ''}`).join('、')}。
                  燈號為規則自動計算的參考，不構成投資建議。
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Drawdown Progress Meter */}
      <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center justify-between">
            <span>SOXX 週期回撤深度監控階梯</span>
            <span className="text-xs font-mono text-muted-foreground">
              目前回撤: <span className="text-primary font-bold">{drawdown.toFixed(2)}%</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className={`p-2 rounded-lg border ${drawdown <= -20 ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-border/40 bg-background/50 text-muted-foreground'}`}>
              <div className="font-bold">-20%</div>
              <div className="text-[10px]">一般修正</div>
            </div>
            <div className={`p-2 rounded-lg border ${drawdown <= -30 ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-border/40 bg-background/50 text-muted-foreground'}`}>
              <div className="font-bold">-30%</div>
              <div className="text-[10px]">熊市警戒</div>
            </div>
            <div className={`p-2 rounded-lg border ${drawdown <= -40 ? 'border-primary/60 bg-primary/20 text-primary glow-primary' : 'border-border/40 bg-background/50 text-muted-foreground'}`}>
              <div className="font-bold">-40%</div>
              <div className="text-[10px]">第 1 批候選區</div>
            </div>
            <div className={`p-2 rounded-lg border ${drawdown <= -50 ? 'border-primary/60 bg-primary/20 text-primary glow-primary' : 'border-border/40 bg-background/50 text-muted-foreground'}`}>
              <div className="font-bold">-50%</div>
              <div className="text-[10px]">第 2 批候選區</div>
            </div>
            <div className={`p-2 rounded-lg border ${drawdown <= -60 ? 'border-rose-500/60 bg-rose-500/20 text-rose-300' : 'border-border/40 bg-background/50 text-muted-foreground'}`}>
              <div className="font-bold">-60%</div>
              <div className="text-[10px]">第 3 批極端區</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tranches & Human Confirmation */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 4 Entry Tranches */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-base font-semibold text-foreground flex items-center justify-between">
              <span>四批次進場狀態機 (每批 2.5%)</span>
              <Badge variant="outline" className="border-primary/40 text-primary text-xs">
                持倉上限 10%
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              盤中曾跌到 -40% 即啟動狙擊期，之後每 4 週解鎖一批；跌更深或站回均線會提前解鎖。每批需人工確認。
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {tranches.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-background/50"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{t.name}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        t.status === 'READY'
                          ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                          : 'border-muted-foreground/30 text-muted-foreground'
                      }`}
                    >
                      {t.status === 'READY' ? '可候選 (需人工確認)' : t.status === 'DONE' ? '已執行' : '等待條件成立'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.condition}</p>
                </div>
                {t.status === 'READY' ? (
                  <Button
                    size="sm"
                    onClick={() => handleConfirmTranche(t.id, 2.5)}
                    className="bg-primary text-primary-foreground hover:bg-primary/80 text-xs font-semibold"
                  >
                    人工確認執行
                  </Button>
                ) : (
                  <Clock className="size-4 text-muted-foreground/50 mr-2" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Exit Rules & Risk Constraints */}
        <div className="space-y-6">
          <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-base font-semibold text-foreground">
                SOXL 分批停利與退出規則
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2.5">
              {exitTiers.map((tier, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs p-2.5 rounded-lg border border-border/40 bg-background/50"
                >
                  <div>
                    <span className="font-semibold text-foreground mr-2">{tier.tier}</span>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                      {tier.gain}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground">{tier.action}</span>
                </div>
              ))}
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
                <strong>重大退場警示：</strong>SOXX 若連續 2 週收盤跌破 40 週均線 (40W MA)，系統將產生警示建議退出剩餘持倉。
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-400" />
                強制執行之風險紀律
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 space-y-1.5 text-xs">
              {riskRules.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                  <span>{r.rule}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
