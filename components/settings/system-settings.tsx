'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Settings, Database, ArrowRightLeft, Shield, Save, CheckCircle2, AlertTriangle, Bitcoin } from 'lucide-react'
import { toast } from 'sonner'
import { usePortfolioStore } from '@/lib/portfolio-store'

export function SystemSettings() {
  const [displayCurrency, setDisplayCurrency] = useState('TWD')
  const [exchangeRate, setExchangeRate] = useState('32.5')
  const [monthlyInvestment, setMonthlyInvestment] = useState('20000')
  const [emergencyFund, setEmergencyFund] = useState('0')
  const [soxlMaxPosition, setSoxlMaxPosition] = useState('10')
  const [saving, setSaving] = useState(false)
  const [mstrNetDebt, setMstrNetDebt] = useState('0')
  const [mstrPreferred, setMstrPreferred] = useState('0')
  const [mstrSharesOverride, setMstrSharesOverride] = useState('')
  const [savingMstr, setSavingMstr] = useState(false)
  const applySettings = usePortfolioStore((s) => s.applySettings)
  const refreshAll = usePortfolioStore((s) => s.refreshAll)
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null)

  useEffect(() => {
    // Load current settings from /api/portfolio
    fetch('/api/portfolio', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
        return data
      })
      .then((data) => {
        if (data.settings) {
          setDisplayCurrency(data.settings.displayCurrency || 'TWD')
          setExchangeRate(String(data.settings.exchangeRate ?? 32.5))
          setMonthlyInvestment(String(data.settings.monthlyInvestmentAmount ?? 20000))
          setEmergencyFund(String(data.settings.emergencyFundAmount ?? 0))
          setSoxlMaxPosition(String(data.settings.soxlMaxPositionPercent ?? 10))
          setMstrNetDebt(String(data.settings.mstrNetDebtUsd ?? 0))
          setMstrPreferred(String(data.settings.mstrPreferredStockUsd ?? 0))
          setMstrSharesOverride(
            data.settings.mstrDilutedSharesOverride != null ? String(data.settings.mstrDilutedSharesOverride) : ''
          )
        }
      })
      .catch((err) => toast.error('讀取系統設定失敗', { description: err.message }))
  }, [])

  const handleSaveSettings = async () => {
    try {
      setSaving(true)
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayCurrency,
          exchangeRate: Number(exchangeRate),
          monthlyInvestmentAmount: Number(monthlyInvestment),
          emergencyFundAmount: Number(emergencyFund),
          soxlMaxPositionPercent: Number(soxlMaxPosition),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // 同步回全域 store，其他頁面的幣別與匯率立即一致
        applySettings({ displayCurrency: data.settings?.displayCurrency, exchangeRate: data.settings?.exchangeRate })
        toast.success('系統設定已成功儲存至資料庫')
      } else {
        toast.error('儲存失敗', { description: data?.error })
      }
    } catch (err) {
      toast.error('無法連線至後端伺服器')
    } finally {
      setSaving(false)
    }
  }

  /** MSTR EV mNAV 參數：只送這三個欄位（PUT 為局部更新），稀釋股數留空 = 自動抓 SEC */
  const handleSaveMstrSettings = async () => {
    const netDebt = mstrNetDebt.trim() === '' ? 0 : Number(mstrNetDebt)
    const preferred = mstrPreferred.trim() === '' ? 0 : Number(mstrPreferred)
    const sharesRaw = mstrSharesOverride.trim()
    const shares = sharesRaw === '' ? null : Number(sharesRaw)
    if (!Number.isFinite(netDebt) || netDebt < 0 || !Number.isFinite(preferred) || preferred < 0) {
      toast.error('淨負債與優先股面額必須是 0 以上的數字')
      return
    }
    if (shares !== null && (!Number.isFinite(shares) || shares <= 0)) {
      toast.error('稀釋股數覆蓋必須大於 0，或留空改用 SEC 自動抓取')
      return
    }
    try {
      setSavingMstr(true)
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mstrNetDebtUsd: netDebt,
          mstrPreferredStockUsd: preferred,
          mstrDilutedSharesOverride: shares,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMstrNetDebt(String(data.settings?.mstrNetDebtUsd ?? netDebt))
        setMstrPreferred(String(data.settings?.mstrPreferredStockUsd ?? preferred))
        setMstrSharesOverride(
          data.settings?.mstrDilutedSharesOverride != null ? String(data.settings.mstrDilutedSharesOverride) : ''
        )
        toast.success('MSTR EV mNAV 參數已儲存至資料庫')
      } else {
        toast.error('儲存失敗', { description: data?.error })
      }
    } catch {
      toast.error('無法連線至後端伺服器')
    } finally {
      setSavingMstr(false)
    }
  }

  const handleMigrateFromLocalStorage = async () => {
    try {
      const raw = localStorage.getItem('portfolio-storage')
      if (!raw) {
        toast.info('在目前瀏覽器中未發現舊版的 LocalStorage 資料')
        return
      }

      const parsed = JSON.parse(raw)
      const categories = parsed?.state?.categories || []

      if (categories.length === 0) {
        toast.info('舊版 LocalStorage 中沒有資產或分類資料')
        return
      }

      const confirmed = window.confirm(
        `偵測到舊版 LocalStorage 內有 ${categories.length} 個分類。\n\n注意：匯入會「清空並覆蓋」資料庫現有的所有分類與資產（交易紀錄保留）。確定要繼續嗎？`
      )
      if (!confirmed) return

      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories,
          displayCurrency: parsed?.state?.displayCurrency || 'TWD',
          exchangeRate: parsed?.state?.exchangeRate || 32.5,
          confirmOverwrite: true,
        }),
      })

      const result = await res.json().catch(() => ({}))
      if (res.ok) {
        await refreshAll()
        toast.success('成功遷移資料！已重新載入最新資產')
        setMigrationStatus(`已成功遷移 ${result.migratedCategories} 個分類至資料庫`)
      } else {
        toast.error(`遷移失敗: ${result.error}`)
      }
    } catch (err: any) {
      toast.error(`遷移過程發生錯誤: ${err.message}`)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-border/40 pb-4">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Settings className="size-5 text-primary" />
          系統參數與資料庫設定
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          所有設定與個人投資資料儲存在 Turso 雲端資料庫（與 SQLite 相容），電腦與手機看到的是同一份資料；本機未設定雲端資料庫時，改存在 ./data/portfolio.db。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Currency & Fund Settings */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <ArrowRightLeft className="size-4 text-primary" />
              幣別與投資資金參數
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">主要顯示幣別</Label>
              <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TWD">新台幣 (TWD)</SelectItem>
                  <SelectItem value="USD">美元 (USD)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">基準美元匯率 (1 USD = ? TWD)</Label>
              <Input
                type="number"
                step="0.01"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">每月預計可投資金額 (NTD)</Label>
              <Input
                type="number"
                step="1000"
                value={monthlyInvestment}
                onChange={(e) => setMonthlyInvestment(e.target.value)}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">預設新台幣 20,000 元，可隨時調整。</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">生活緊急預備金 (NTD - 嚴格隔離)</Label>
              <Input
                type="number"
                step="10000"
                value={emergencyFund}
                onChange={(e) => setEmergencyFund(e.target.value)}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-amber-400">
                嚴格規定：生活緊急預備金不可納入 SOXL 預備金或任何投資組合。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">SOXL 持倉上限（占總資產 %）</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                max="100"
                value={soxlMaxPosition}
                onChange={(e) => setSoxlMaxPosition(e.target.value)}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                定案預設 10%（每批 2.5% × 4 批）；改上限時每批自動 = 上限 ÷ 4。實盤與回測共用此設定。
              </p>
            </div>

            <Button
              onClick={handleSaveSettings}
              disabled={saving}
              className="w-full text-xs gap-1.5 bg-primary text-primary-foreground mt-2"
            >
              <Save className="size-3.5" />
              <span>{saving ? '儲存中...' : '儲存系統設定'}</span>
            </Button>
          </CardContent>
        </Card>

        {/* Database & Migration Management */}
        <div className="space-y-6">
          <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Bitcoin className="size-4 text-amber-400" />
                MSTR EV mNAV 參數
              </CardTitle>
              <CardDescription className="text-xs">
                EV mNAV ＝（市值＋淨負債＋優先股）÷ 持有 BTC 價值。請依 MSTR 最新季報更新。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mstr-net-debt" className="text-xs">淨負債（USD）</Label>
                <Input
                  id="mstr-net-debt"
                  type="number"
                  step="1000000"
                  min="0"
                  value={mstrNetDebt}
                  onChange={(e) => setMstrNetDebt(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">可轉債等總負債扣除現金後的金額，預設 0。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mstr-preferred" className="text-xs">優先股面額（USD）</Label>
                <Input
                  id="mstr-preferred"
                  type="number"
                  step="1000000"
                  min="0"
                  value={mstrPreferred}
                  onChange={(e) => setMstrPreferred(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">STRK、STRF 等特別股的清算面額合計，預設 0。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mstr-shares" className="text-xs">稀釋股數覆蓋（股）</Label>
                <Input
                  id="mstr-shares"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="留空＝自動抓 SEC"
                  value={mstrSharesOverride}
                  onChange={(e) => setMstrSharesOverride(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">留空代表自動使用 SEC 最新季報的稀釋股數。</p>
              </div>
              <Button
                onClick={handleSaveMstrSettings}
                disabled={savingMstr}
                className="w-full text-xs gap-1.5 bg-primary text-primary-foreground"
              >
                <Save className="size-3.5" />
                <span>{savingMstr ? '儲存中...' : '儲存 MSTR 參數'}</span>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Database className="size-4 text-emerald-400" />
                資料庫狀態
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50">
                <span className="text-muted-foreground">資料庫驅動與引擎</span>
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                  Turso (libSQL) + Drizzle ORM
                </Badge>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50">
                <span className="text-muted-foreground">資料儲存位置</span>
                <span className="font-mono text-[11px] text-foreground">Turso 雲端（本機未設定時為 ./data/portfolio.db）</span>
              </div>

              <div className="p-3 rounded-lg border border-border/40 bg-background/50 space-y-1.5">
                <span className="font-semibold text-foreground">一鍵備份說明</span>
                <p className="text-muted-foreground leading-relaxed">
                  雲端資料庫的備份請到 Turso 後台處理；<code>backup.bat</code> 只會備份本機模式使用的 <code>portfolio.db</code>（複製並打上時間戳記至 <code>./data/backups/</code>）。
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Shield className="size-4 text-primary" />
                瀏覽器舊版 LocalStorage 遷移
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                若您在升級前已在瀏覽器 LocalStorage 建立過資產，點擊下方按鈕可將其一鍵無損匯入資料庫。
              </p>
              <Button
                variant="outline"
                onClick={handleMigrateFromLocalStorage}
                className="w-full text-xs border-primary/50 text-primary hover:bg-primary/20"
              >
                手動從 LocalStorage 匯入現有資產
              </Button>
              {migrationStatus && (
                <div className="flex items-center gap-2 text-emerald-400 pt-1">
                  <CheckCircle2 className="size-4" />
                  <span>{migrationStatus}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
