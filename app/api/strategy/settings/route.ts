import { NextResponse } from 'next/server'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { loadSoxlConfig } from '@/lib/strategies/config-loader'
import { buildSoxlStrategySettingsJson, resolveSoxlConfig } from '@/lib/strategies/config'
import { SoxlSettingsError, validateSoxlSettingsUpdate } from '@/lib/strategies/settings-update'

export const dynamic = 'force-dynamic'

/** 讀取目前生效的 SOXL 策略參數與預設值 */
export async function GET() {
  try {
    await ensureTablesExist()
    const config = await loadSoxlConfig()
    const row = await sqlite.get<{ updated_at: string }>("SELECT updated_at FROM strategy_settings WHERE id = 'soxl_sniper'")
    return NextResponse.json({ config, defaults: resolveSoxlConfig(), updatedAt: row?.updated_at ?? null })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '讀取策略參數失敗' }, { status: 500 })
  }
}

/**
 * 儲存 SOXL 策略參數（整份覆寫；body.reset = true 則還原預設）
 * 同步更新 portfolio_settings.soxl_max_position_percent，避免兩處上限不一致。
 */
export async function PUT(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => null)
    const config = body?.reset === true ? resolveSoxlConfig() : validateSoxlSettingsUpdate(body?.config)
    const now = new Date().toISOString()
    await sqlite.batch([
      {
        sql: `INSERT INTO strategy_settings (id, strategy_name, config_json, updated_at)
              VALUES ('soxl_sniper', 'SOXL_SNIPER', ?, ?)
              ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
        args: [JSON.stringify(buildSoxlStrategySettingsJson(config)), now],
      },
      {
        sql: `INSERT INTO portfolio_settings (id, soxl_max_position_percent, updated_at)
              VALUES ('default', ?, ?)
              ON CONFLICT(id) DO UPDATE SET soxl_max_position_percent = excluded.soxl_max_position_percent, updated_at = excluded.updated_at`,
        args: [config.maxPositionPercent, now],
      },
    ])
    const effective = await loadSoxlConfig()
    return NextResponse.json({ success: true, config: effective, updatedAt: now })
  } catch (error: any) {
    if (error instanceof SoxlSettingsError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error.message || '儲存策略參數失敗' }, { status: 500 })
  }
}
