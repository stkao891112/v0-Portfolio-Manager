import { NextResponse } from 'next/server'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'

export const dynamic = 'force-dynamic'

/** 策略訊號／決策歷史（含決策當下快照與覆寫理由），新到舊 */
export async function GET(request: Request) {
  try {
    await ensureTablesExist()
    const url = new URL(request.url)
    const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 20)))
    const rows = await sqlite.all<any>(
      `SELECT id, strategy_name, signal_type, symbol, price, indicator_values, trigger_condition,
              recommended_action, status, created_at, executed_at
       FROM strategy_signals ORDER BY created_at DESC LIMIT ?`,
      [limit]
    )
    const signals = rows.map((r) => {
      let extra: any = null
      try {
        extra = r.indicator_values ? JSON.parse(r.indicator_values) : null
      } catch {
        extra = null
      }
      return {
        id: r.id,
        strategy: r.strategy_name,
        signalType: r.signal_type,
        symbol: r.symbol,
        price: Number(r.price),
        triggerCondition: r.trigger_condition,
        recommendedAction: r.recommended_action,
        status: r.status,
        createdAt: r.created_at,
        snapshot: extra?.snapshot ?? null,
      }
    })
    return NextResponse.json({ signals })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '讀取決策歷史失敗' }, { status: 500 })
  }
}
