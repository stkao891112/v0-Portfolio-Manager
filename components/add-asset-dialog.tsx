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
import { usePortfolioStore } from '@/lib/portfolio-store'

interface AddAssetDialogProps {
  categoryId: string
  categoryName: string
}

export function AddAssetDialog({ categoryId, categoryName }: AddAssetDialogProps) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [targetPercent, setTargetPercent] = useState('')
  const addAsset = usePortfolioStore((state) => state.addAsset)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (symbol.trim() && targetPercent) {
      addAsset(categoryId, symbol.trim(), parseFloat(targetPercent))
      setSymbol('')
      setTargetPercent('')
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
      <DialogContent className="border-border/50 bg-card/95 backdrop-blur-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-foreground">新增投資標的</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              在「{categoryName}」分類下新增標的與目標比例
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="symbol" className="text-foreground">
                標的代號
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
            <div className="grid gap-2">
              <Label htmlFor="targetPercent" className="text-foreground">
                目標比例 (%)
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
          </div>
          <DialogFooter>
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
