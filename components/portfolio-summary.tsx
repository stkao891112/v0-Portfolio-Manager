'use client'

import { TrendingUp, Layers, Target, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'

interface PortfolioSummaryProps {
  categories: Category[]
}

export function PortfolioSummary({ categories }: PortfolioSummaryProps) {
  const { displayCurrency, convertToDisplayCurrency } = usePortfolioStore()
  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  const totalValue = categories.reduce(
    (sum, cat) => sum + cat.assets.reduce((s, a) => {
      const value = a.quantity * a.costPerUnit
      return s + convertToDisplayCurrency(value, a.currency || 'USD')
    }, 0),
    0
  )
  
  const totalAssets = categories.reduce((sum, cat) => sum + cat.assets.length, 0)
  
  const totalTargetPercent = categories.reduce(
    (sum, cat) => sum + cat.assets.reduce((s, a) => s + a.targetPercent, 0),
    0
  )
  
  // Calculate max deviation
  let maxDeviation = 0
  categories.forEach((cat) => {
    cat.assets.forEach((asset) => {
      const assetValueOriginal = asset.quantity * asset.costPerUnit
      const assetValue = convertToDisplayCurrency(assetValueOriginal, asset.currency || 'USD')
      const actualPercent = totalValue > 0 ? (assetValue / totalValue) * 100 : 0
      const deviation = Math.abs(actualPercent - asset.targetPercent)
      if (deviation > maxDeviation) {
        maxDeviation = deviation
      }
    })
  })

  const stats = [
    {
      label: '總資產價值',
      value: `${currencySymbol}${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
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
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
