'use client'

import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Edit2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { AddAssetDialog } from './add-asset-dialog'
import { AssetRow } from './asset-row'

interface CategoryCardProps {
  category: Category
  totalPortfolioValue: number
}

export function CategoryCard({ category, totalPortfolioValue }: CategoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)
  
  const { removeCategory, updateCategory, convertToDisplayCurrency, displayCurrency } = usePortfolioStore()
  
  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'
  
  const categoryValue = category.assets.reduce(
    (sum, asset) => {
      const value = asset.quantity * asset.costPerUnit
      return sum + convertToDisplayCurrency(value, asset.currency || 'USD')
    },
    0
  )
  const categoryPercent = totalPortfolioValue > 0 
    ? (categoryValue / totalPortfolioValue) * 100 
    : 0
  const totalTargetPercent = category.assets.reduce(
    (sum, asset) => sum + asset.targetPercent,
    0
  )

  const handleSave = () => {
    if (editName.trim()) {
      updateCategory(category.id, editName.trim())
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setEditName(category.name)
    setIsEditing(false)
  }

  return (
    <Card className="overflow-hidden border-border/40 bg-card/80 backdrop-blur-sm transition-all hover:border-border/60">
      <CardHeader className="border-b border-border/30 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-4 rounded-md"
              style={{ backgroundColor: category.color }}
            />
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 w-40 bg-input/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                    if (e.key === 'Escape') handleCancel()
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleSave}
                  className="text-success hover:text-success hover:bg-success/10"
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCancel}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <CardTitle className="text-lg font-semibold text-foreground">
                {category.name}
              </CardTitle>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-lg font-semibold text-foreground">
                {currencySymbol}{categoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>實際 {categoryPercent.toFixed(1)}%</span>
                <span className="text-border">|</span>
                <span>目標 {totalTargetPercent.toFixed(1)}%</span>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsEditing(true)}
                  className="text-muted-foreground hover:text-primary"
                >
                  <Edit2 className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeCategory(category.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-4">
          {category.assets.length > 0 ? (
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 px-3 text-xs font-medium text-muted-foreground">
                <div className="col-span-2">標的</div>
                <div className="col-span-2">目標比例</div>
                <div className="col-span-3">持有數量 x 成本</div>
                <div className="col-span-2">現值 / 實際比例</div>
                <div className="col-span-2">建議調整</div>
                <div className="col-span-1"></div>
              </div>
              
              {/* Asset Rows */}
              {category.assets.map((asset) => (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  categoryId={category.id}
                  totalPortfolioValue={totalPortfolioValue}
                  categoryColor={category.color}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-muted-foreground">
                尚未新增任何投資標的
              </p>
            </div>
          )}
          
          <div className="mt-4 flex justify-center border-t border-border/30 pt-4">
            <AddAssetDialog categoryId={category.id} categoryName={category.name} />
          </div>
        </CardContent>
      )}
    </Card>
  )
}
