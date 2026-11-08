'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Settings, Database, ArrowRightLeft, Shield, Save, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

export function SystemSettings() {
  const [displayCurrency, setDisplayCurrency] = useState('TWD')
  const [exchangeRate, setExchangeRate] = useState('32.5')
  const [monthlyInvestment, setMonthlyInvestment] = useState('20000')
  const [emergencyFund, setEmergencyFund] = useState('0')
  const [saving, setSaving] = useState(false)
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null)

  useEffect(() => {
    // Load current settings from /api/portfolio
    fetch('/api/portfolio')
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) {
          setDisplayCurrency(data.settings.displayCurrency || 'TWD')
          setExchangeRate(String(data.settings.exchangeRate || 32.5))
          setMonthlyInvestment(String(data.settings.monthlyInvestmentAmount || 20000))
          setEmergencyFund(String(data.settings.emergencyFundAmount || 0))
        }
      })
      .catch((err) => console.error('Failed to load settings:', err))
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
        }),
      })
      if (res.ok) {
        toast.success('系統設定已成功儲存至 SQLite 資料庫')
      } else {
        toast.error('儲存失敗')
      }
    } catch (err) {
      toast.error('無法連線至後端伺服器')
    } finally {
      setSaving(false)
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
        `偵測到舊版 LocalStorage 內有 ${categories.length} 個分類，是否立即遷移並覆寫至 SQLite 本機資料庫？`
      )
      if (!confirmed) return

      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories,
          displayCurrency: parsed?.state?.displayCurrency || 'TWD',
          exchangeRate: parsed?.state?.exchangeRate || 32.5,
        }),
      })

      const result = await res.json()
      if (res.ok) {
        toast.success('成功遷移資料！請重新整理頁面以查看最新資產')
        setMigrationStatus(`已成功遷移 ${result.migratedCategories} 個分類至 SQLite`)
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
          系統參數與本機資料庫設定
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          所有設定與個人投資資料均安全儲存在本機 SQLite 資料庫（./data/portfolio.db），完全不外傳雲端。
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
                <Database className="size-4 text-emerald-400" />
                本機 SQLite 資料庫狀態
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50">
                <span className="text-muted-foreground">資料庫驅動與引擎</span>
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                  better-sqlite3 + Drizzle ORM
                </Badge>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50">
                <span className="text-muted-foreground">資料庫實體檔案位置</span>
                <span className="font-mono text-[11px] text-foreground">./data/portfolio.db</span>
              </div>

              <div className="p-3 rounded-lg border border-border/40 bg-background/50 space-y-1.5">
                <span className="font-semibold text-foreground">一鍵備份說明</span>
                <p className="text-muted-foreground leading-relaxed">
                  系統提供 <code>backup.bat</code> 腳本，執行時會自動將 <code>portfolio.db</code> 複製並打上時間戳記備份至 <code>./data/backups/</code>。
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
                若您在升級前已在瀏覽器 LocalStorage 建立過資產，點擊下方按鈕可將其一鍵無損匯入 SQLite 本機資料庫。
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
