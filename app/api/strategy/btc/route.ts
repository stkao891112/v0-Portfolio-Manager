import { NextResponse } from 'next/server'
import { marketService } from '@/lib/market-data/market-service'
import { sqlite } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'

export async function GET() {
  try {
    ensureTablesExist()

    // 1. Fetch live quotes for BTC and MSTR
    const [btcQuote, mstrQuote] = await Promise.all([
      marketService.getQuote('BTC'),
      marketService.getQuote('MSTR'),
    ])

    // 2. Fetch strategy settings
    const settingRow = sqlite
      .prepare("SELECT config_json FROM strategy_settings WHERE id = 'btc_mstr'")
      .get() as any

    const config = settingRow
      ? JSON.parse(settingRow.config_json)
      : {
          currentPhase: 'BULL_MID',
          phases: {
            BULL_EARLY: { label: '牛市初期', mstrRatio: 0.7, btcRatio: 0.3 },
            BULL_MID: { label: '牛市中期', mstrRatio: 0.5, btcRatio: 0.5 },
            BULL_LATE: { label: '牛市後期', mstrRatio: 0.3, btcRatio: 0.7 },
            BEAR_WAITING: { label: '熊市等待期', mstrRatio: 0.0, btcRatio: 1.0 },
          },
        }

    const currentPhase = config.currentPhase || 'BULL_MID'
    const phaseRules = config.phases[currentPhase] || { mstrRatio: 0.5, btcRatio: 0.5 }

    // 3. Ratio calculation
    const mstrBtcRatio = btcQuote.price > 0 ? mstrQuote.price / btcQuote.price : 0

    // 4. Actual holdings from SQLite
    const btcAsset = sqlite.prepare("SELECT * FROM assets WHERE symbol = 'BTC'").get() as any
    const mstrAsset = sqlite.prepare("SELECT * FROM assets WHERE symbol = 'MSTR'").get() as any

    const btcQty = btcAsset ? btcAsset.quantity : 0
    const mstrQty = mstrAsset ? mstrAsset.quantity : 0

    const btcValue = btcQty * btcQuote.price
    const mstrValue = mstrQty * mstrQuote.price
    const totalCryptoValue = btcValue + mstrValue

    const actualMstrRatio = totalCryptoValue > 0 ? mstrValue / totalCryptoValue : 0
    const actualBtcRatio = totalCryptoValue > 0 ? btcValue / totalCryptoValue : 0

    const mstrDeviation = (actualMstrRatio - phaseRules.mstrRatio) * 100
    const btcDeviation = (actualBtcRatio - phaseRules.btcRatio) * 100

    return NextResponse.json({
      currentPhase,
      phaseRules,
      btcQuote,
      mstrQuote,
      mstrBtcRatio,
      holdings: {
        btcQty,
        btcValue,
        actualBtcRatio: Number((actualBtcRatio * 100).toFixed(1)),
        targetBtcRatio: Number((phaseRules.btcRatio * 100).toFixed(1)),
        btcDeviation: Number(btcDeviation.toFixed(1)),
        mstrQty,
        mstrValue,
        actualMstrRatio: Number((actualMstrRatio * 100).toFixed(1)),
        targetMstrRatio: Number((phaseRules.mstrRatio * 100).toFixed(1)),
        mstrDeviation: Number(mstrDeviation.toFixed(1)),
        totalCryptoValue,
      },
    })
  } catch (error: any) {
    console.error('BTC/MSTR Strategy API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureTablesExist()
    const body = await request.json()
    const { phase } = body

    if (!phase) {
      return NextResponse.json({ error: 'Phase is required' }, { status: 400 })
    }

    const settingRow = sqlite
      .prepare("SELECT config_json FROM strategy_settings WHERE id = 'btc_mstr'")
      .get() as any

    const config = settingRow ? JSON.parse(settingRow.config_json) : {}
    config.currentPhase = phase

    const now = new Date().toISOString()
    sqlite.prepare(`
      UPDATE strategy_settings SET config_json = ?, updated_at = ? WHERE id = 'btc_mstr'
    `).run(JSON.stringify(config), now)

    return NextResponse.json({ success: true, updatedPhase: phase })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
