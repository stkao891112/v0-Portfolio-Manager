import { NextResponse } from 'next/server'
import { sqlite, type Statement } from '@/lib/db/client'
import { ensureTablesExist } from '@/lib/db/init'
import { applyTrade, reverseTrade, LedgerError, TRADE_TYPES, type TradeType } from '@/lib/ledger'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

const toTx = (r: any) => ({
  id: r.id,
  assetId: r.asset_id,
  symbol: r.symbol,
  type: r.type,
  date: r.date,
  quantity: Number(r.quantity),
  price: Number(r.price),
  fee: Number(r.fee) || 0,
  currency: r.currency,
  exchangeRate: Number(r.exchange_rate) || 1,
  realizedPnl: r.realized_pnl == null ? null : Number(r.realized_pnl),
  notes: r.notes,
  strategyTranche: r.strategy_tranche == null ? null : Number(r.strategy_tranche),
  createdAt: r.created_at,
})

/**
 * GET /api/transactions?limit=50&offset=0&assetId=...&symbol=...
 * 不帶 limit 時回傳全部（舊版寫死只回 100 筆）。
 */
export async function GET(request: Request) {
  try {
    await ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const where: string[] = []
    const args: (string | number)[] = []
    const assetId = searchParams.get('assetId')
    const symbol = searchParams.get('symbol')
    if (assetId) {
      where.push('asset_id = ?')
      args.push(assetId)
    }
    if (symbol) {
      where.push('UPPER(symbol) = ?')
      args.push(symbol.toUpperCase())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const limitRaw = searchParams.get('limit')
    const offsetRaw = searchParams.get('offset')
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), 1000) : null
    const offset = offsetRaw ? Math.max(parseInt(offsetRaw, 10) || 0, 0) : 0

    const totalRow = await sqlite.get<{ c: number }>(`SELECT count(*) AS c FROM transactions ${whereSql}`, args)
    const rows = await sqlite.all<any>(
      `SELECT * FROM transactions ${whereSql} ORDER BY date DESC, created_at DESC${limit ? ' LIMIT ? OFFSET ?' : ''}`,
      limit ? [...args, limit, offset] : args
    )
    const total = Number(totalRow?.c ?? 0)
    return NextResponse.json({
      transactions: rows.map(toTx),
      total,
      limit,
      offset,
      hasMore: limit ? offset + rows.length < total : false,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * 新增交易。帶 assetId（或代號能對應到唯一資產）時，同步更新持倉數量與移動平均成本；
 * SELL 超過持有量回 400，並寫入已實現損益。
 */
export async function POST(request: Request) {
  try {
    await ensureTablesExist()
    const body = await request.json().catch(() => ({}))
    const { assetId, date, notes } = body
    const type = String(body.type || '').toUpperCase() as TradeType
    const quantity = Number(body.quantity)
    const price = Number(body.price)
    const fee = body.fee === undefined || body.fee === '' ? 0 : Number(body.fee)

    if (!TRADE_TYPES.includes(type)) {
      return NextResponse.json({ error: '交易類型必須是 BUY / SELL / DIVIDEND / INITIAL_BALANCE' }, { status: 400 })
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return NextResponse.json({ error: '交易日期格式必須是 YYYY-MM-DD' }, { status: 400 })
    }

    // 找出對應資產：優先用 assetId，否則用代號找唯一一筆
    let asset: any = null
    if (assetId) {
      asset = await sqlite.get<any>('SELECT * FROM assets WHERE id = ?', [assetId])
      if (!asset) return NextResponse.json({ error: '找不到指定的資產' }, { status: 404 })
    } else if (body.symbol) {
      const matches = await sqlite.all<any>('SELECT * FROM assets WHERE UPPER(symbol) = ?', [String(body.symbol).toUpperCase()])
      if (matches.length === 1) asset = matches[0]
    }
    const symbol = String(asset?.symbol ?? body.symbol ?? '').toUpperCase().trim()
    if (!symbol) return NextResponse.json({ error: '請選擇資產或輸入標的代號' }, { status: 400 })
    const currency = asset?.currency ?? (body.currency === 'USD' ? 'USD' : 'TWD')

    if (type === 'SELL' && !asset) {
      return NextResponse.json(
        { error: `找不到 ${symbol} 的持倉，無法賣出；請先在「資產配置」建立該標的或選擇現有資產` },
        { status: 400 }
      )
    }

    // 驗證並計算（數量、價格 > 0；超賣直接拋錯）
    const position = { quantity: Number(asset?.quantity) || 0, costPerUnit: Number(asset?.cost_per_unit) || 0 }
    const result = applyTrade(position, { type, quantity, price, fee })

    const id = uuidv4()
    const now = new Date().toISOString()
    const exchangeRate = Number(body.exchangeRate) > 0 ? Number(body.exchangeRate) : 1.0
    const statements: Statement[] = [
      {
        sql: `
          INSERT INTO transactions (
            id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, realized_pnl, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [id, asset?.id ?? null, symbol, type, date, quantity, price, fee, currency, exchangeRate, result.realizedPnl, notes || null, now],
      },
    ]

    if (asset && type !== 'DIVIDEND') {
      statements.push({
        sql: 'UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?',
        args: [result.position.quantity, result.position.costPerUnit, now, asset.id],
      })
    }

    // 交易紀錄與持倉更新一次寫入（全部成功或全部不生效）
    await sqlite.batch(statements)

    return NextResponse.json({
      success: true,
      id,
      assetId: asset?.id ?? null,
      realizedPnl: result.realizedPnl,
      position: asset ? result.position : null,
      warning: asset ? undefined : `沒有對應的資產，只記錄交易、不更新持倉`,
    })
  } catch (error: any) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * 刪除（沖銷）錯誤的交易紀錄：DELETE /api/transactions?id=...
 * 有關聯資產時同步回沖持倉（只回沖這一筆；之後若還有其他交易，平均成本為近似值，回應會提示核對）。
 */
export async function DELETE(request: Request) {
  try {
    await ensureTablesExist()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: '缺少交易 id' }, { status: 400 })

    const tx = await sqlite.get<any>('SELECT * FROM transactions WHERE id = ?', [id])
    if (!tx) return NextResponse.json({ error: '找不到這筆交易' }, { status: 404 })

    const statements: Statement[] = [{ sql: 'DELETE FROM transactions WHERE id = ?', args: [id] }]
    let position: { quantity: number; costPerUnit: number } | null = null
    let warning: string | undefined

    const asset = tx.asset_id ? await sqlite.get<any>('SELECT * FROM assets WHERE id = ?', [tx.asset_id]) : null
    if (asset && tx.type !== 'DIVIDEND') {
      position = reverseTrade(
        { quantity: Number(asset.quantity) || 0, costPerUnit: Number(asset.cost_per_unit) || 0 },
        { type: tx.type, quantity: Number(tx.quantity), price: Number(tx.price), fee: Number(tx.fee) || 0 }
      )
      statements.push({
        sql: 'UPDATE assets SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?',
        args: [position.quantity, position.costPerUnit, new Date().toISOString(), asset.id],
      })
      const later = await sqlite.get<{ c: number }>(
        'SELECT count(*) AS c FROM transactions WHERE asset_id = ? AND id <> ? AND (date > ? OR (date = ? AND created_at > ?))',
        [asset.id, id, tx.date, tx.date, tx.created_at]
      )
      if (Number(later?.c ?? 0) > 0) {
        warning = `${asset.symbol} 在這筆之後還有其他交易，回沖後的平均成本為近似值，請到資產配置核對`
      }
    } else if (!asset && tx.type !== 'DIVIDEND') {
      warning = '這筆交易沒有關聯的資產，已刪除紀錄但未調整任何持倉'
    }

    await sqlite.batch(statements)
    return NextResponse.json({ success: true, position, warning })
  } catch (error: any) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
