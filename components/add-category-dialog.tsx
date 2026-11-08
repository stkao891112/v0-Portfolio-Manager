'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { toast } from 'sonner'

export function AddCategoryDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const addCategory = usePortfolioStore((state) => state.addCategory)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      const categoryName = name.trim()
      addCategory(categoryName)
      toast.success(`已建立分類「${categoryName}」`)
      setName('')
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="glow-primary">
          <Plus className="size-4" />
          新增分類
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border/50 bg-card/95 backdrop-blur-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-foreground">新增投資分類</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              建立新的投資類別，例如：加密貨幣、美股、台股
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="輸入分類名稱..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-input/50 border-border/50"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              確認新增
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
