'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { Currency } from '@/lib/portfolio-types'
import { toast } from 'sonner'

interface AddAssetDialogProps {
  categoryId: string
  categoryName: string
}

export function AddAssetDialog({ categoryId, categoryName }: AddAssetDialogProps) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [targetPercent, setTargetPercent] = useState('')
  const [quantity, setQuantity] = useState('')
  const [costPerUnit, setCostPerUnit] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const addAsset = usePortfolioStore((state) => state.addAsset)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (symbol.trim() && targetPercent) {
      const formattedSymbol = symbol.trim().toUpperCase()
      const parsedQuantity = parseFloat(quantity) || 0
      const parsedCost = parseFloat(costPerUnit) || 0
      addAsset(
        categoryId,
        formattedSymbol,
        parseFloat(targetPercent),
        currency,
        parsedQuantity,
        parsedCost
      )
      toast.success(`已新增標的 ${formattedSymbol}`)
      setSymbol('')
      setTargetPercent('')
      setQuantity('')
      setCostPerUnit('')
      setCurrency('USD')
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary hover:bg-primary/10">
          <Plus className="size-4" />
          新增標的
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border/50 bg-card/95 backdrop-blur-xl sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-foreground">新增投資標的</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              在「{categoryName}」分類下新增標的與目標配置比例
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 grid gap-1.5">
                <Label htmlFor="symbol" className="text-xs text-foreground">
                  標的代號 *
                </Label>
                <Input
                  id="symbol"
                  placeholder="例如：BTC, AAPL, 2330"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="bg-input/50 border-border/50 uppercase"
                  autoFocus
                />
              </div>
              <div className="col-span-1 grid gap-1.5">
                <Label htmlFor="currency" className="text-xs text-foreground">
                  幣種
                </Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger className="bg-input/50 border-border/50">
                    <SelectValue placeholder="選擇幣種" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="TWD">TWD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="targetPercent" className="text-xs text-foreground">
                目標比例 (%) *
              </Label>
              <Input
                id="targetPercent"
                type="number"
                placeholder="例如：25"
                value={targetPercent}
                onChange={(e) => setTargetPercent(e.target.value)}
                className="bg-input/50 border-border/50"
                min="0"
                max="100"
                step="0.1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="quantity" className="text-xs text-muted-foreground">
                  持有數量 (選填)
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  placeholder="例如：10"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="bg-input/50 border-border/50"
                  min="0"
                  step="any"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="costPerUnit" className="text-xs text-muted-foreground">
                  成本單價 (選填)
                </Label>
                <Input
                  id="costPerUnit"
                  type="number"
                  placeholder={`例如：150`}
                  value={costPerUnit}
                  onChange={(e) => setCostPerUnit(e.target.value)}
                  className="bg-input/50 border-border/50"
                  min="0"
                  step="any"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!symbol.trim() || !targetPercent}>
              確認新增
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
