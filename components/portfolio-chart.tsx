'use client'

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { DarkTooltip } from '@/components/charts/dark-tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Category } from '@/lib/portfolio-types'
import { usePortfolioStore } from '@/lib/portfolio-store'
import { valueAsset } from '@/lib/valuation'

interface PortfolioChartProps {
  categories: Category[]
  type: 'actual' | 'target'
}

export function PortfolioChart({ categories, type }: PortfolioChartProps) {
  const { displayCurrency, exchangeRate } = usePortfolioStore()
  const currencySymbol = displayCurrency === 'USD' ? '$' : 'NT$'

  const data = categories.flatMap((category) =>
    category.assets.map((asset) => {
      // 共用估值口徑：市價 = 現價（沒有報價時用成本價）
      const convertedValue = valueAsset(asset, displayCurrency, exchangeRate).marketValue
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

/** 依代號彙總實際權重與目標權重（同代號多帳戶合併） */
export function buildAllocationCompare(
  categories: Category[],
  displayCurrency: 'TWD' | 'USD',
  exchangeRate: number
): { symbol: string; actual: number; target: number; diff: number }[] {
  const bySymbol = new Map<string, { value: number; target: number }>()
  let total = 0
  for (const category of categories) {
    for (const asset of category.assets) {
      const sym = (asset.symbol || '').trim().toUpperCase() || asset.name || '—'
      const value = valueAsset(asset, displayCurrency, exchangeRate).marketValue
      const row = bySymbol.get(sym) ?? { value: 0, target: 0 }
      row.value += value
      row.target += Number(asset.targetPercent) || 0
      bySymbol.set(sym, row)
      total += value
    }
  }
  return [...bySymbol.entries()]
    .map(([symbol, r]) => {
      const actual = total > 0 ? Number(((r.value / total) * 100).toFixed(2)) : 0
      const target = Number(r.target.toFixed(2))
      return { symbol, actual, target, diff: Number((actual - target).toFixed(2)) }
    })
    .filter((r) => r.actual > 0 || r.target > 0)
    .sort((a, b) => Math.max(b.actual, b.target) - Math.max(a.actual, a.target))
}

/** 實際 vs 目標配置對比（水平條狀圖） */
export function AllocationCompareChart({ categories }: { categories: Category[] }) {
  const { displayCurrency, exchangeRate } = usePortfolioStore()
  const data = buildAllocationCompare(categories, displayCurrency, exchangeRate)
  if (data.length === 0) return null
  const height = Math.max(180, data.length * 34 + 40)

  return (
    <Card className="border-border/40 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">實際 vs 目標配置對比（%）</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11 }} width={70} />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              content={
                <DarkTooltip
                  valueFormatter={(v, _name, entry) =>
                    entry?.dataKey === 'actual' && entry?.payload
                      ? `${v.toFixed(2)}%（偏離 ${entry.payload.diff >= 0 ? '+' : ''}${entry.payload.diff.toFixed(2)}）`
                      : `${v.toFixed(2)}%`
                  }
                />
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="actual" name="實際" fill="#38bdf8" radius={[0, 3, 3, 0]} barSize={10} />
            <Bar dataKey="target" name="目標" fill="#a78bfa" radius={[0, 3, 3, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
