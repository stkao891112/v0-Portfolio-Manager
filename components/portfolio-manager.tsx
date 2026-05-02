'use client'

import { usePortfolioStore } from '@/lib/portfolio-store'
import { AddCategoryDialog } from './add-category-dialog'
import { CategoryCard } from './category-card'
import { PortfolioChart } from './portfolio-chart'
import { PortfolioSummary } from './portfolio-summary'
import { Wallet, Sparkles } from 'lucide-react'

export function PortfolioManager() {
  const categories = usePortfolioStore((state) => state.categories)
  
  const totalPortfolioValue = categories.reduce(
    (sum, cat) => sum + cat.assets.reduce((s, a) => s + a.quantity * a.costPerUnit, 0),
    0
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 glow-primary">
              <Wallet className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Portfolio Manager
              </h1>
              <p className="text-xs text-muted-foreground">
                投資組合配置整理器
              </p>
            </div>
          </div>
          
          <AddCategoryDialog />
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        {categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
              <Sparkles className="size-10 text-primary" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              開始建立你的投資組合
            </h2>
            <p className="mb-6 max-w-md text-center text-muted-foreground">
              新增投資分類（如加密貨幣、美股、台股），設定目標比例，追蹤你的資產配置
            </p>
            <AddCategoryDialog />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary Stats */}
            <PortfolioSummary categories={categories} />
            
            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <PortfolioChart categories={categories} type="actual" />
              <PortfolioChart categories={categories} type="target" />
            </div>
            
            {/* Category Cards */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  投資分類
                </h2>
                <span className="text-sm text-muted-foreground">
                  {categories.length} 個分類
                </span>
              </div>
              
              {categories.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  totalPortfolioValue={totalPortfolioValue}
                />
              ))}
            </div>
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-muted-foreground">
          資料僅供參考，投資有風險，請謹慎評估
        </div>
      </footer>
    </div>
  )
}
