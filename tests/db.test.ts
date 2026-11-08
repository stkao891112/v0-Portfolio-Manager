import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensureTablesExist, seedDefaultPortfolioIfEmpty } from '../lib/db/init'
import { sqlite } from '../lib/db/client'

describe('Database Architecture & Initialization Tests', () => {
  it('should ensure all required schema tables exist in SQLite', () => {
    ensureTablesExist()

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]

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

  it('should seed default 5-category portfolio blueprint matching requirements', () => {
    seedDefaultPortfolioIfEmpty()

    const cats = sqlite.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all() as any[]
    expect(cats.length).toBe(5)

    const catNames = cats.map((c) => c.name)
    expect(catNames).toContain('台股主力')
    expect(catNames).toContain('美股核心')
    expect(catNames).toContain('SOXL 機會預備金')
    expect(catNames).toContain('加密貨幣')
    expect(catNames).toContain('現金流工具')

    // Verify assets
    const assets = sqlite.prepare('SELECT * FROM assets').all() as any[]
    const symbols = assets.map((a) => a.symbol)
    expect(symbols).toContain('2330.TW')
    expect(symbols).toContain('00935.TW')
    expect(symbols).toContain('00662.TW')
    expect(symbols).toContain('SOXL')
    expect(symbols).toContain('BTC')
    expect(symbols).toContain('MSTR')

    // Verify strategy settings
    const soxlStrat = sqlite.prepare("SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'").get() as any
    expect(soxlStrat).toBeDefined()
    const parsedSoxl = JSON.parse(soxlStrat.config_json)
    expect(parsedSoxl.tranches.length).toBe(4)
    expect(parsedSoxl.exits.length).toBe(3)
  })
})
