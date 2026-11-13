import { describe, it, expect, beforeAll } from 'vitest'

// 測試用獨立的本機資料庫檔案，不碰正式資料（data/*.db 已被 .gitignore 排除）
process.env.TURSO_DATABASE_URL = 'file:data/test.db'
delete process.env.TURSO_AUTH_TOKEN

import { ensureTablesExist, seedDefaultPortfolioIfEmpty } from '../lib/db/init'
import { sqlite } from '../lib/db/client'

describe('Database Architecture & Initialization Tests', () => {
  beforeAll(async () => {
    await ensureTablesExist()
  })

  it('should ensure all required schema tables exist', async () => {
    const tables = await sqlite.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )

    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('portfolio_settings')
    expect(tableNames).toContain('categories')
    expect(tableNames).toContain('assets')
    expect(tableNames).toContain('transactions')
    expect(tableNames).toContain('strategy_settings')
    expect(tableNames).toContain('strategy_signals')
    expect(tableNames).toContain('market_prices')
    expect(tableNames).toContain('weekly_snapshots')
  })

  it('should seed default 5-category portfolio blueprint matching requirements', async () => {
    // 同時呼叫兩次，確認不會重複建立預設資料
    await Promise.all([seedDefaultPortfolioIfEmpty(), seedDefaultPortfolioIfEmpty()])

    const cats = await sqlite.all<any>('SELECT * FROM categories ORDER BY sort_order ASC')
    expect(cats.length).toBe(5)

    const catNames = cats.map((c) => c.name)
    expect(catNames).toContain('台股主力')
    expect(catNames).toContain('美股核心')
    expect(catNames).toContain('SOXL 機會預備金')
    expect(catNames).toContain('加密貨幣')
    expect(catNames).toContain('現金流工具')

    // Verify assets
    const assets = await sqlite.all<any>('SELECT * FROM assets')
    const symbols = assets.map((a) => a.symbol)
    expect(symbols).toContain('2330.TW')
    expect(symbols).toContain('00935.TW')
    expect(symbols).toContain('00662.TW')
    expect(symbols).toContain('SOXL')
    expect(symbols).toContain('BTC')
    expect(symbols).toContain('MSTR')

    // Verify strategy settings
    const soxlStrat = await sqlite.get<any>("SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'")
    expect(soxlStrat).toBeDefined()
    const parsedSoxl = JSON.parse(soxlStrat.config_json)
    expect(parsedSoxl.tranches.length).toBe(4)
    expect(parsedSoxl.exits.length).toBe(3)
  })

  it('should keep transactions but unlink them when a category is deleted', async () => {
    const asset = await sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'BTC'")
    expect(asset).toBeDefined()

    const now = new Date().toISOString()
    await sqlite.run(
      `INSERT INTO transactions (id, asset_id, symbol, type, date, quantity, price, fee, currency, exchange_rate, notes, created_at)
       VALUES ('test-tx-1', ?, 'BTC', 'BUY', '2026-01-01', 1, 100, 0, 'USD', 1, NULL, ?)`,
      [asset.id, now]
    )

    // 與 app/api/categories DELETE 相同的刪除步驟
    await sqlite.batch([
      {
        sql: 'UPDATE transactions SET asset_id = NULL WHERE asset_id IN (SELECT id FROM assets WHERE category_id = ?)',
        args: [asset.category_id],
      },
      { sql: 'DELETE FROM assets WHERE category_id = ?', args: [asset.category_id] },
      { sql: 'DELETE FROM categories WHERE id = ?', args: [asset.category_id] },
    ])

    const tx = await sqlite.get<any>("SELECT * FROM transactions WHERE id = 'test-tx-1'")
    expect(tx).toBeDefined()
    expect(tx.asset_id).toBeNull()
    const remaining = await sqlite.all<any>('SELECT * FROM assets WHERE category_id = ?', [asset.category_id])
    expect(remaining.length).toBe(0)

    // 還原成初始狀態，讓下次執行測試時一樣從預設資料開始
    await sqlite.batch([
      { sql: "DELETE FROM transactions WHERE id = 'test-tx-1'" },
      { sql: 'DELETE FROM assets' },
      { sql: 'DELETE FROM categories' },
    ])
  })
})
