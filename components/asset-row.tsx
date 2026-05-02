'use client'

import { useState } from 'react'
import { Trash2, TrendingUp, TrendingDown, Minus, Edit2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Asset, Currency } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'

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
  
  const { updateAsset, removeAsset, convertToDisplayCurrency, displayCurrency } = usePortfolioStore()
  
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
    setIsEditing(false)
  }

  const handleCancel = () => {
    setQuantity(asset.quantity.toString())
    setCostPerUnit(asset.costPerUnit.toString())
    setTargetPercent(asset.targetPercent.toString())
    setCurrency(asset.currency || 'USD')
    setIsEditing(false)
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
    <div className="group grid grid-cols-12 items-center gap-2 rounded-lg border border-border/30 bg-secondary/30 p-3 transition-all hover:border-border/50 hover:bg-secondary/50">
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
            className="h-7 w-16 bg-input/50 text-xs"
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
            <div className="font-medium">
              {adjustmentValue >= 0 ? '+' : ''}{currencySymbol}{Math.abs(adjustmentValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-muted-foreground">
              ({adjustmentUnits >= 0 ? '+' : ''}{adjustmentUnits.toFixed(2)} 單位)
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>

      {/* Actions */}
      <div className="col-span-1 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {isEditing ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleSave}
              className="text-success hover:text-success hover:bg-success/10"
            >
              <Check className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCancel}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsEditing(true)}
              className="text-muted-foreground hover:text-primary"
            >
              <Edit2 className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeAsset(categoryId, asset.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
