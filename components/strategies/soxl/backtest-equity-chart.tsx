'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts'
import { DarkTooltip } from '@/components/charts/dark-tooltip'

interface EquityPoint {
  date: string
  equity: number
  soxxPrice: number
}

/** 由淨值曲線計算每一點相對歷史最高淨值的回撤（%，≤ 0） */
export function buildUnderwaterSeries(curve: EquityPoint[]) {
  let peak = 0
  return curve.map((p) => {
    peak = Math.max(peak, p.equity)
    const drawdown = peak > 0 ? Number(((p.equity / peak - 1) * 100).toFixed(2)) : 0
    return { date: p.date, equity: Number(p.equity.toFixed(2)), drawdown }
  })
}

/** 回測淨值曲線＋水下回撤圖（Underwater Drawdown Chart） */
export function BacktestEquityChart({ equityCurve }: { equityCurve: EquityPoint[] | undefined }) {
  const series = buildUnderwaterSeries(equityCurve ?? [])
  if (series.length === 0) return null
  const minDd = Math.min(0, ...series.map((p) => p.drawdown))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <span className="text-xs font-semibold text-foreground">回測淨值曲線（USD）</span>
        <div className="h-56 rounded-lg border border-border/40 bg-background/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="btEquityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis
                tick={{ fontSize: 10 }}
                width={55}
                domain={['auto', 'auto']}
                tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
              />
              <Tooltip
                content={<DarkTooltip valueFormatter={(v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />}
              />
              <Area type="monotone" dataKey="equity" name="策略淨值" stroke="#38bdf8" fill="url(#btEquityFill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-2">
        <span className="text-xs font-semibold text-foreground">
          水下回撤圖（相對歷史最高淨值）｜最深 <span className="font-mono text-rose-400">{minDd.toFixed(2)}%</span>
        </span>
        <div className="h-56 rounded-lg border border-border/40 bg-background/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="btUnderwaterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} width={45} domain={[Math.floor(minDd * 1.1) || -1, 0]} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<DarkTooltip valueFormatter={(v) => `${v.toFixed(2)}%`} />} />
              <ReferenceLine y={0} stroke="#64748b" />
              <Area type="monotone" dataKey="drawdown" name="回撤" stroke="#f43f5e" fill="url(#btUnderwaterFill)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
