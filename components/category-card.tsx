'use client'

import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Edit2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { toast } from 'sonner'
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

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
      const newName = editName.trim()
      updateCategory(category.id, newName)
      toast.success(`已將分類名稱更新為「${newName}」`)
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setEditName(category.name)
    setIsEditing(false)
  }

  const handleDeleteCategory = () => {
    removeCategory(category.id)
    toast.success(`已刪除分類「${category.name}」`)
    setDeleteDialogOpen(false)
  }

  return (
    <Card className="overflow-hidden border-border/40 bg-card/80 backdrop-blur-sm transition-all hover:border-border/60">
      <CardHeader className="border-b border-border/30 pb-3 sm:pb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* 左側：分類標籤、名稱與動作按鈕 */}
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className="size-3.5 sm:size-4 rounded-md shrink-0"
                style={{ backgroundColor: category.color }}
              />
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 w-36 sm:w-44 bg-input/50 text-sm"
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
                    className="size-8 text-success hover:text-success hover:bg-success/10"
                    aria-label="儲存名稱"
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleCancel}
                    className="size-8 text-muted-foreground hover:text-foreground"
                    aria-label="取消編輯"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <CardTitle className="text-base sm:text-lg font-semibold text-foreground">
                  {category.name}
                </CardTitle>
              )}
            </div>

            {/* 行動端右側動作按鈕 */}
            <div className="flex items-center gap-1 sm:hidden">
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsEditing(true)}
                  className="size-8 text-muted-foreground hover:text-primary"
                  aria-label="編輯分類名稱"
                >
                  <Edit2 className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteDialogOpen(true)}
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label="刪除分類"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label={isExpanded ? '收合分類' : '展開分類'}
              >
                {isExpanded ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* 右側：金額、實際/目標比例與桌面按鈕 */}
          <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-border/20 pt-2 sm:border-0 sm:pt-0">
            <div className="text-left sm:text-right">
              <div className="font-mono text-base sm:text-lg font-semibold text-foreground">
                {currencySymbol}{categoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>實際 {categoryPercent.toFixed(1)}%</span>
                <span className="text-border">|</span>
                <span>目標 {totalTargetPercent.toFixed(1)}%</span>
              </div>
            </div>

            {/* 桌面端按鈕 */}
            <div className="hidden sm:flex items-center gap-1">
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsEditing(true)}
                  className="text-muted-foreground hover:text-primary"
                  aria-label="編輯分類名稱"
                >
                  <Edit2 className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteDialogOpen(true)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="刪除分類"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={isExpanded ? '收合分類' : '展開分類'}
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

      {/* 刪除分類二次防呆確認 AlertDialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="border-border/50 bg-card/95 backdrop-blur-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">確定要刪除「{category.name}」分類？</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm space-y-1">
              {category.assets.length > 0 ? (
                <>
                  此分類下包含 <span className="font-semibold text-foreground">{category.assets.length}</span> 個投資標的，總資產價值約為{' '}
                  <span className="font-semibold text-foreground font-mono">
                    {currencySymbol}{categoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  。刪除後該分類及所屬標的將一併移除，且無法復原。
                </>
              ) : (
                <>此分類尚未新增標的，確認刪除後將移除此分類卡片。</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isExpanded && (
        <CardContent className="pt-3 sm:pt-4">
          {category.assets.length > 0 ? (
            <div className="space-y-2">
              {/* 桌面端專屬表頭 (Desktop Only Header) */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-3 text-xs font-medium text-muted-foreground">
                <div className="col-span-2">標的</div>
                <div className="col-span-2">目標比例</div>
                <div className="col-span-3">持有數量 x 成本</div>
                <div className="col-span-2">現值 / 實際比例</div>
                <div className="col-span-2">建議調整</div>
                <div className="col-span-1"></div>
              </div>

              {/* 標的清單 (Asset Rows: 自動響應手機卡片與桌面表格) */}
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
