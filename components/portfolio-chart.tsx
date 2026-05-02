'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'

interface PortfolioChartProps {
  categories: Category[]
  type: 'actual' | 'target'
}

export function PortfolioChart({ categories, type }: PortfolioChartProps) {
  const { displayCurrency, convertToDisplayCurrency } = usePortfolioStore()
  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  const data = categories.flatMap((category) =>
    category.assets.map((asset) => {
      const originalValue = asset.quantity * asset.costPerUnit
      const convertedValue = convertToDisplayCurrency(originalValue, asset.currency || 'USD')
      return {
        name: asset.symbol,
        value: type === 'actual' 
          ? convertedValue 
          : asset.targetPercent,
        color: category.color,
        category: category.name,
      }
    })
  ).filter((item) => item.value > 0)

  const total = data.reduce((sum, item) => sum + item.value, 0)

  if (data.length === 0) {
    return (
      <Card className="border-border/40 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {type === 'actual' ? '實際配置' : '目標配置'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex h-[200px] items-center justify-center">
          <p className="text-sm text-muted-foreground">尚無資料</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/40 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {type === 'actual' ? '實際配置' : '目標配置'}
        </CardTitle>
        {type === 'actual' && (
          <div className="font-mono text-2xl font-bold text-foreground">
            {currencySymbol}{total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
              stroke="transparent"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'oklch(0.16 0.015 260)',
                border: '1px solid oklch(0.28 0.02 260)',
                borderRadius: '8px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              }}
              itemStyle={{ color: 'oklch(0.95 0.01 260)' }}
              labelStyle={{ color: 'oklch(0.95 0.01 260)', fontWeight: 'bold' }}
              formatter={(value: number) => {
                if (type === 'actual') {
                  const percent = (value / total) * 100
                  return [`${currencySymbol}${value.toLocaleString()} (${percent.toFixed(1)}%)`, '']
                }
                return [`${value.toFixed(1)}%`, '']
              }}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{ paddingLeft: '20px' }}
              formatter={(value) => (
                <span className="text-xs text-foreground">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
