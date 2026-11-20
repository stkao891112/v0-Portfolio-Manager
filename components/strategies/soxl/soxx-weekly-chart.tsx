'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { DarkTooltip } from '@/components/charts/dark-tooltip'

export interface SoxxWeeklyPoint {
  t: string
  close: number
  ma10w: number | null
  ma40w: number | null
}

interface SoxxWeeklyChartProps {
  series: SoxxWeeklyPoint[]
  cyclePeak: number | null | undefined
  /** 狙擊階梯回撤（%），預設 -40 / -50 / -60 */
  ladder?: number[]
}

const LADDER_COLORS = ['#a78bfa', '#f59e0b', '#f43f5e']

/** SOXX 週線走勢：收盤、10W / 40W 均線，標示本輪高點與狙擊階梯價位 */
export function SoxxWeeklyChart({ series, cyclePeak, ladder = [-40, -50, -60] }: SoxxWeeklyChartProps) {
  const peak = cyclePeak && cyclePeak > 0 ? cyclePeak : null
  const levels = peak ? ladder.map((dd) => ({ dd, price: Number((peak * (1 + dd / 100)).toFixed(2)) })) : []

  // Y 軸範圍要包含高點與最深的階梯價位，參考線才不會被裁掉
  const values = series.flatMap((p) => [p.close, p.ma10w, p.ma40w]).filter((v): v is number => v != null && v > 0)
  const all = [...values, ...(peak ? [peak] : []), ...levels.map((l) => l.price)]
  const yMin = all.length ? Math.floor(Math.min(...all) * 0.95) : 0
  const yMax = all.length ? Math.ceil(Math.max(...all) * 1.03) : 1

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-foreground">SOXX 週線走勢與狙擊階梯</CardTitle>
        <CardDescription className="text-xs">
          近 {series.length} 週收盤、10 週與 40 週均線；虛線為本輪高點與 {ladder.join('% / ')}% 狙擊價位。
        </CardDescription>
      </CardHeader>
      <CardContent className="h-72">
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">尚無週線資料</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} width={50} domain={[yMin, yMax]} tickFormatter={(v) => `$${Math.round(v)}`} />
              <Tooltip content={<DarkTooltip valueFormatter={(v) => `$${v.toFixed(2)}`} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="close" name="SOXX 收盤" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="ma10w" name="10W MA" stroke="#34d399" dot={false} strokeWidth={1.5} connectNulls />
              <Line type="monotone" dataKey="ma40w" name="40W MA" stroke="#f472b6" dot={false} strokeWidth={1.5} connectNulls />
              {peak && (
                <ReferenceLine
                  y={peak}
                  stroke="#94a3b8"
                  strokeDasharray="6 4"
                  label={{ value: `高點 $${peak.toFixed(2)}`, position: 'insideTopLeft', fill: '#cbd5e1', fontSize: 10 }}
                />
              )}
              {levels.map((l, i) => (
                <ReferenceLine
                  key={l.dd}
                  y={l.price}
                  stroke={LADDER_COLORS[i % LADDER_COLORS.length]}
                  strokeDasharray="4 4"
                  label={{
                    value: `${l.dd}% $${l.price.toFixed(2)}`,
                    position: 'insideBottomLeft',
                    fill: LADDER_COLORS[i % LADDER_COLORS.length],
                    fontSize: 10,
                  }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
