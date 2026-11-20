'use client'

import { TrendingUp, TrendingDown, Layers, Target, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { valuePortfolio, valueAsset } from '@/lib/valuation'
import { QuoteStatus } from './quote-status'

interface PortfolioSummaryProps {
  categories: Category[]
}

export function PortfolioSummary({ categories }: PortfolioSummaryProps) {
  const { displayCurrency, exchangeRate } = usePortfolioStore()
  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  // 共用估值口徑：市價 = 現價（沒有報價時用成本價）
  const valuation = valuePortfolio(categories, displayCurrency, exchangeRate)
  const totalValue = valuation.totalValue
  
  const totalAssets = categories.reduce((sum, cat) => sum + cat.assets.length, 0)
  
  const totalTargetPercent = categories.reduce(
    (sum, cat) => sum + cat.assets.reduce((s, a) => s + a.targetPercent, 0),
    0
  )
  
  // Calculate max deviation
  let maxDeviation = 0
  categories.forEach((cat) => {
    cat.assets.forEach((asset) => {
      const assetValue = valueAsset(asset, displayCurrency, exchangeRate).marketValue
      const actualPercent = totalValue > 0 ? (assetValue / totalValue) * 100 : 0
      const deviation = Math.abs(actualPercent - asset.targetPercent)
      if (deviation > maxDeviation) {
        maxDeviation = deviation
      }
    })
  })

  const stats = [
    {
      label: '總資產市值',
      value: `${currencySymbol}${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: '未實現損益',
      value: `${valuation.unrealizedPnl >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(valuation.unrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: valuation.unrealizedPnl >= 0 ? TrendingUp : TrendingDown,
      color: valuation.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive',
      bgColor: valuation.unrealizedPnl >= 0 ? 'bg-success/10' : 'bg-destructive/10',
    },
    {
      label: '投資分類',
      value: categories.length.toString(),
      icon: Layers,
      color: 'text-chart-2',
      bgColor: 'bg-chart-2/10',
    },
    {
      label: '投資標的',
      value: totalAssets.toString(),
      icon: Target,
      color: 'text-chart-4',
      bgColor: 'bg-chart-4/10',
    },
    {
      label: '最大偏離',
      value: `${maxDeviation.toFixed(1)}%`,
      icon: AlertTriangle,
      color: maxDeviation > 5 ? 'text-warning' : 'text-success',
      bgColor: maxDeviation > 5 ? 'bg-warning/10' : 'bg-success/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <QuoteStatus className="col-span-full" />
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="border-border/40 bg-card/80 backdrop-blur-sm transition-all hover:border-border/60"
        >
          <CardContent className="flex items-center gap-2.5 sm:gap-4 p-3 sm:p-4">
            <div className={`rounded-lg p-2 sm:p-2.5 shrink-0 ${stat.bgColor}`}>
              <stat.icon className={`size-4 sm:size-5 ${stat.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{stat.label}</p>
              <p className="font-mono text-sm sm:text-xl font-bold text-foreground truncate">
                {stat.value}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
      
      {totalTargetPercent !== 100 && totalAssets > 0 && (
        <div className="col-span-full">
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-center gap-3 p-3">
              <AlertTriangle className="size-4 text-warning" />
              <p className="text-sm text-warning">
                目標比例總和為 {totalTargetPercent.toFixed(1)}%，建議調整為 100%
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
