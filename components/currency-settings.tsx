'use client'

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
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

export function CurrencySettings() {
  const { displayCurrency, exchangeRate, setDisplayCurrency, setExchangeRate } = usePortfolioStore()
  const [open, setOpen] = useState(false)
  const [tempCurrency, setTempCurrency] = useState<Currency>(displayCurrency)
  const [tempRate, setTempRate] = useState(exchangeRate.toString())

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setTempCurrency(displayCurrency)
      setTempRate(exchangeRate.toString())
    }
    setOpen(isOpen)
  }

  const handleSave = () => {
    setDisplayCurrency(tempCurrency)
    const rate = parseFloat(tempRate) || 32.5
    setExchangeRate(rate)
    toast.success(`幣種與匯率設定已儲存 (1 USD = ${rate} TWD)`)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 border-border/50 bg-card/50">
          <Settings2 className="size-4" />
          <span className="font-mono">{displayCurrency}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border/50 bg-card/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">幣種設定</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            設定顯示幣種與匯率換算
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="displayCurrency" className="text-foreground">
              主要顯示幣種
            </Label>
            <Select value={tempCurrency} onValueChange={(v) => setTempCurrency(v as Currency)}>
              <SelectTrigger className="bg-input/50 border-border/50">
                <SelectValue placeholder="選擇幣種" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD 美元</SelectItem>
                <SelectItem value="TWD">TWD 台幣</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              所有資產價值將換算為此幣種顯示
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exchangeRate" className="text-foreground">
              匯率 (1 USD = ? TWD)
            </Label>
            <Input
              id="exchangeRate"
              type="number"
              placeholder="例如：32.5"
              value={tempRate}
              onChange={(e) => setTempRate(e.target.value)}
              className="bg-input/50 border-border/50"
              min="0"
              step="0.01"
            />
            <p className="text-xs text-muted-foreground">
              手動輸入當前美元兌台幣匯率
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            儲存設定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
