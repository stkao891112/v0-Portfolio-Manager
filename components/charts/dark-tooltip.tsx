'use client'

/**
 * Recharts 共用深色 Tooltip（bg-slate-900/95 border-slate-700 text-slate-100）
 * 用法：<Tooltip content={<DarkTooltip valueFormatter={(v) => ...} />} />
 */
export interface DarkTooltipProps {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string | null; color?: string; dataKey?: string | number; payload?: any }>
  label?: string | number
  valueFormatter?: (value: number, name: string, entry: any) => string
  labelFormatter?: (label: string | number) => string
}

export function DarkTooltip({ active, payload, label, valueFormatter, labelFormatter }: DarkTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.filter((p) => p.value != null)
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur-sm">
      {label != null && label !== '' && (
        <div className="mb-1 font-semibold text-slate-100">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      <div className="space-y-0.5">
        {rows.map((p, i) => (
          <div key={`${p.dataKey ?? p.name}-${i}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-mono tabular-nums text-slate-100">
              {typeof p.value === 'number' && valueFormatter
                ? valueFormatter(p.value, String(p.name ?? ''), p)
                : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
