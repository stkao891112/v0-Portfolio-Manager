'use client'

import { useState } from 'react'
import { Trash2, TrendingUp, TrendingDown, Minus, Edit2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Asset, Currency } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { toast } from 'sonner'

interface AssetRowProps {
  asset: Asset
  categoryId: string
  totalPortfolioValue: number
  categoryColor: string
}

export function AssetRow({ asset, categoryId, totalPortfolioValue, categoryColor }: AssetRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [quantity, setQuantity] = useState(asset.quantity.toString())
  const [costPerUnit, setCostPerUnit] = useState(asset.costPerUnit.toString())
  const [targetPercent, setTargetPercent] = useState(asset.targetPercent.toString())
  const [currency, setCurrency] = useState<Currency>(asset.currency || 'USD')

  const { updateAsset, removeAsset, restoreAsset, convertToDisplayCurrency, displayCurrency } = usePortfolioStore()

  const assetValueInOriginal = asset.quantity * asset.costPerUnit
  const assetValue = convertToDisplayCurrency(assetValueInOriginal, asset.currency || 'USD')
  const actualPercent = totalPortfolioValue > 0 ? (assetValue / totalPortfolioValue) * 100 : 0
  const deviation = actualPercent - asset.targetPercent
  const targetValue = (asset.targetPercent / 100) * totalPortfolioValue
  const adjustmentValue = targetValue - assetValue

  // Convert adjustment back to original currency for unit calculation
  const adjustmentInOriginal = asset.currency === displayCurrency
    ? adjustmentValue
    : (asset.currency === 'USD' && displayCurrency === 'TWD')
      ? adjustmentValue / usePortfolioStore.getState().exchangeRate
      : adjustmentValue * usePortfolioStore.getState().exchangeRate
  const adjustmentUnits = asset.costPerUnit > 0 ? adjustmentInOriginal / asset.costPerUnit : 0

  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'
  const originalCurrencySymbol = (asset.currency || 'USD') === 'USD' ? '$' : 'NT$'

  const handleSave = () => {
    updateAsset(categoryId, asset.id, {
      quantity: parseFloat(quantity) || 0,
      costPerUnit: parseFloat(costPerUnit) || 0,
      targetPercent: parseFloat(targetPercent) || 0,
      currency,
    })
    toast.success(`已更新標的「${asset.symbol}」`)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setQuantity(asset.quantity.toString())
    setCostPerUnit(asset.costPerUnit.toString())
    setTargetPercent(asset.targetPercent.toString())
    setCurrency(asset.currency || 'USD')
    setIsEditing(false)
  }

  const handleDelete = () => {
    const category = usePortfolioStore.getState().categories.find((c) => c.id === categoryId)
    const assetIndex = category?.assets.findIndex((a) => a.id === asset.id) ?? -1

    removeAsset(categoryId, asset.id)
    toast.success(`已刪除標的「${asset.symbol}」`, {
      action: {
        label: '復原',
        onClick: () => {
          restoreAsset(categoryId, asset, assetIndex)
          toast.info(`已復原標的「${asset.symbol}」`)
        },
      },
    })
  }

  const getDeviationColor = () => {
    if (Math.abs(deviation) < 2) return 'text-muted-foreground'
    if (deviation > 0) return 'text-warning'
    return 'text-success'
  }

  const getDeviationIcon = () => {
    if (Math.abs(deviation) < 2) return <Minus className="size-3" />
    if (deviation > 0) return <TrendingUp className="size-3" />
    return <TrendingDown className="size-3" />
  }

  return (
    <>
      {/* 行動端卡片視圖 (Mobile Card View: < md) */}
      <div className="block md:hidden rounded-lg border border-border/40 bg-card/60 backdrop-blur-sm p-3.5 transition-all hover:border-border/60">
        {isEditing ? (
          /* 行動端編輯表單 */
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <div className="flex items-center gap-2">
                <div
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: categoryColor }}
                />
                <span className="font-mono text-sm font-bold text-foreground">
                  編輯 {asset.symbol}
                </span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                編輯模式
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">目標比例 (%)</Label>
                <Input
                  type="number"
                  value={targetPercent}
                  onChange={(e) => setTargetPercent(e.target.value)}
                  className="h-8 bg-input/50 text-xs"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">計價幣種</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger className="h-8 bg-input/50 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD 美元</SelectItem>
                    <SelectItem value="TWD">TWD 台幣</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">持有數量</Label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-8 bg-input/50 text-xs"
                  placeholder="0"
                  min="0"
                  step="any"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">每單位成本</Label>
                <Input
                  type="number"
                  value={costPerUnit}
                  onChange={(e) => setCostPerUnit(e.target.value)}
                  className="h-8 bg-input/50 text-xs"
                  placeholder="0"
                  min="0"
                  step="any"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="flex-1 h-8 text-xs"
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="flex-1 h-8 text-xs glow-primary"
              >
                儲存變更
              </Button>
            </div>
          </div>
        ) : (
          /* 行動端瀏覽卡片 */
          <div className="space-y-2.5">
            {/* 卡片標頭列 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: categoryColor }}
                />
                <span className="font-mono text-base font-bold text-foreground">
                  {asset.symbol}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                  {asset.currency || 'USD'}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[11px] px-1.5 py-0">
                  目標 {asset.targetPercent.toFixed(1)}%
                </Badge>
              </div>

              {/* 觸控按鈕：永遠可見 */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsEditing(true)}
                  className="size-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  aria-label="編輯標的"
                >
                  <Edit2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleDelete}
                  className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="刪除標的"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* 核心資訊列 */}
            <div className="grid grid-cols-2 gap-2 rounded-md bg-secondary/30 p-2.5 text-xs">
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">持有數量 × 成本</p>
                <p className="font-mono font-medium text-foreground">
                  {asset.quantity.toLocaleString()} × {originalCurrencySymbol}{asset.costPerUnit.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground mb-0.5">現值 / 實際佔比</p>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="font-mono font-bold text-foreground">
                    {currencySymbol}{assetValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <div className={`flex items-center text-[11px] font-medium ${getDeviationColor()}`}>
                    {getDeviationIcon()}
                    <span>{actualPercent.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 再平衡建議調整膠囊 */}
            {totalPortfolioValue > 0 && asset.costPerUnit > 0 && (
              <div
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium border ${
                  adjustmentValue >= 0
                    ? 'bg-success/10 border-success/20 text-success'
                    : 'bg-destructive/10 border-destructive/20 text-destructive'
                }`}
              >
                <span>{adjustmentValue >= 0 ? '建議加碼' : '建議減碼'}</span>
                <div className="font-mono text-right">
                  <span>
                    {adjustmentValue >= 0 ? '+' : ''}
                    {currencySymbol}
                    {Math.abs(adjustmentValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="ml-1 opacity-80 text-[11px]">
                    ({adjustmentUnits >= 0 ? '+' : ''}
                    {adjustmentUnits.toFixed(2)} 單位)
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 桌面端表格視圖 (Desktop Grid View: >= md) */}
      <div className="hidden md:grid group grid-cols-12 items-center gap-2 rounded-lg border border-border/30 bg-secondary/30 p-3 transition-all hover:border-border/50 hover:bg-secondary/50">
        {/* Symbol */}
        <div className="col-span-2 flex items-center gap-2">
          <div
            className="size-2 rounded-full"
            style={{ backgroundColor: categoryColor }}
          />
          <div>
            <span className="font-mono text-sm font-semibold text-foreground">
              {asset.symbol}
            </span>
            <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">
              {asset.currency || 'USD'}
            </Badge>
          </div>
        </div>

        {/* Target % */}
        <div className="col-span-2">
          {isEditing ? (
            <Input
              type="number"
              value={targetPercent}
              onChange={(e) => setTargetPercent(e.target.value)}
              className="h-7 w-20 bg-input/50 text-xs"
              min="0"
              max="100"
              step="0.1"
            />
          ) : (
            <Badge variant="outline" className="font-mono text-xs">
              {asset.targetPercent.toFixed(1)}%
            </Badge>
          )}
        </div>

        {/* Quantity & Cost */}
        <div className="col-span-3">
          {isEditing ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-7 w-16 bg-input/50 text-xs"
                  placeholder="數量"
                  min="0"
                  step="any"
                />
                <span className="text-muted-foreground">×</span>
                <Input
                  type="number"
                  value={costPerUnit}
                  onChange={(e) => setCostPerUnit(e.target.value)}
                  className="h-7 w-20 bg-input/50 text-xs"
                  placeholder="成本"
                  min="0"
                  step="any"
                />
              </div>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger className="h-7 w-24 bg-input/50 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="TWD">TWD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              <span className="font-mono">{asset.quantity.toLocaleString()}</span>
              <span className="mx-1">×</span>
              <span className="font-mono">{originalCurrencySymbol}{asset.costPerUnit.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Current Value */}
        <div className="col-span-2">
          <span className="font-mono text-sm font-medium text-foreground">
            {currencySymbol}{assetValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
          <div className={`flex items-center gap-1 text-xs ${getDeviationColor()}`}>
            {getDeviationIcon()}
            <span>{actualPercent.toFixed(1)}%</span>
          </div>
        </div>

        {/* Adjustment */}
        <div className="col-span-2">
          {totalPortfolioValue > 0 && asset.costPerUnit > 0 ? (
            <div className={`text-xs ${adjustmentValue >= 0 ? 'text-success' : 'text-destructive'}`}>
              <div className="font-medium font-mono">
                {adjustmentValue >= 0 ? '+' : ''}{currencySymbol}{Math.abs(adjustmentValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-muted-foreground text-[11px] font-mono">
                ({adjustmentUnits >= 0 ? '+' : ''}{adjustmentUnits.toFixed(2)} 單位)
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>

        {/* Actions */}
        <div className="col-span-1 flex items-center justify-end gap-1 opacity-100 md:opacity-0 transition-opacity group-hover:opacity-100">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSave}
                className="size-7 text-success hover:text-success hover:bg-success/10"
              >
                <Check className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCancel}
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsEditing(true)}
                className="size-7 text-muted-foreground hover:text-primary"
              >
                <Edit2 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                className="size-7 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
