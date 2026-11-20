import { describe, it, expect, beforeAll } from 'vitest'

// API 整合測試用獨立的本機資料庫檔案（data/*.db 已被 .gitignore 排除），不碰正式資料
process.env.TURSO_DATABASE_URL = 'file:data/test-api.db'
delete process.env.TURSO_AUTH_TOKEN

import { ensureTablesExist, runMigrations } from '../lib/db/init'
import { sqlite } from '../lib/db/client'
import * as transactionsApi from '../app/api/transactions/route'
import * as portfolioApi from '../app/api/portfolio/route'
import * as migrateApi from '../app/api/migrate/route'
import * as soxlApi from '../app/api/strategy/soxl/route'
import { getExecutedTranchesSinceCyclePeak } from '../app/api/strategy/soxl/route'
import * as strategySettingsApi from '../app/api/strategy/settings/route'
import * as signalsApi from '../app/api/strategy/signals/route'
import { soxlSnapshotSource } from '../lib/strategies/decision-snapshot'

// 決策快照：測試不打即時行情，改用「各批皆可執行、可停利」的固定狀態
const PERMISSIVE_STATE = {
  tranches: [1, 2, 3, 4].map((tranche) => ({ tranche, status: 'CANDIDATE' })),
  activeSignal: { type: 'SELL_CANDIDATE', title: '測試', reason: '測試', canExecuteBuy: true, isStaleData: false },
}
soxlSnapshotSource.load = async () => PERMISSIVE_STATE
import * as categoriesApi from '../app/api/categories/route'

const json = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const now = new Date().toISOString()

async function resetDb() {
  await sqlite.batch([
    { sql: 'DELETE FROM transactions' },
    { sql: 'DELETE FROM strategy_signals' },
    { sql: 'DELETE FROM assets' },
    { sql: 'DELETE FROM categories' },
    { sql: 'DELETE FROM portfolio_settings' },
    { sql: 'DELETE FROM soxl_cycle_state' },
  ])
  await sqlite.batch([
    {
      sql: `INSERT INTO portfolio_settings (id, display_currency, exchange_rate, monthly_investment_amount,
              emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at)
            VALUES ('default', 'TWD', 30, 45000, 250000, 10, 10, ?)`,
      args: [now],
    },
    { sql: "INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at) VALUES ('c-tw', '台股', 'x', 1, 50, ?, ?)", args: [now, now] },
    { sql: "INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at) VALUES ('c-soxl', 'SOXL 機會預備金', 'y', 2, 10, ?, ?)", args: [now, now] },
    {
      sql: `INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
            VALUES ('a-2330', 'c-tw', '2330.TW', '台積電', 50, 100, 500, 'TWD', ?, ?)`,
      args: [now, now],
    },
    {
      // 300,000 TWD ÷ 30 = 10,000 USD 預備金現金
      sql: `INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
            VALUES ('a-cash', 'c-soxl', 'SOXL_CASH_BUFFER', '現金', 10, 10000, 1, 'USD', ?, ?)`,
      args: [now, now],
    },
  ])
}

describe('API 整合測試（交易帳本、設定局部更新、遷移防呆、SOXL 下單）', () => {
  beforeAll(async () => {
    await ensureTablesExist()
    await resetDb()
  })

  it('transactions：BUY 更新移動平均成本；SELL 寫入 realized_pnl；超賣回 400；數量價格 ≤ 0 回 400', async () => {
    let res = await transactionsApi.POST(
      json('/api/transactions', 'POST', { assetId: 'a-2330', type: 'BUY', date: '2026-11-01', quantity: 100, price: 700, fee: 20 })
    )
    expect(res.status).toBe(200)
    let asset = await sqlite.get<any>("SELECT * FROM assets WHERE id = 'a-2330'")
    expect(asset.quantity).toBe(200)
    expect(asset.cost_per_unit).toBeCloseTo((100 * 500 + 100 * 700 + 20) / 200, 10)

    res = await transactionsApi.POST(
      json('/api/transactions', 'POST', { assetId: 'a-2330', type: 'SELL', date: '2026-11-02', quantity: 201, price: 800 })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('OVERSELL')
    asset = await sqlite.get<any>("SELECT * FROM assets WHERE id = 'a-2330'")
    expect(asset.quantity).toBe(200) // 沒有被偷偷改成 0

    res = await transactionsApi.POST(
      json('/api/transactions', 'POST', { assetId: 'a-2330', type: 'SELL', date: '2026-11-03', quantity: 50, price: 800, fee: 10 })
    )
    const sell = await res.json()
    expect(res.status).toBe(200)
    const avg = (100 * 500 + 100 * 700 + 20) / 200
    expect(sell.realizedPnl).toBeCloseTo((800 - avg) * 50 - 10, 6)
    const row = await sqlite.get<any>('SELECT realized_pnl FROM transactions WHERE id = ?', [sell.id])
    expect(row.realized_pnl).toBeCloseTo((800 - avg) * 50 - 10, 6)

    for (const bad of [{ quantity: 0, price: 1 }, { quantity: 1, price: 0 }, { quantity: -5, price: 1 }]) {
      const r = await transactionsApi.POST(
        json('/api/transactions', 'POST', { assetId: 'a-2330', type: 'BUY', date: '2026-11-04', ...bad })
      )
      expect(r.status).toBe(400)
    }
  })

  it('transactions：GET 不再寫死 100 筆，支援 limit/offset；DELETE 回沖持倉', async () => {
    const all = await (await transactionsApi.GET(new Request('http://localhost/api/transactions'))).json()
    expect(all.total).toBe(2)
    expect(all.transactions).toHaveLength(2)
    const page = await (await transactionsApi.GET(new Request('http://localhost/api/transactions?limit=1&offset=1'))).json()
    expect(page.transactions).toHaveLength(1)
    expect(page.hasMore).toBe(false)

    const sellTx = all.transactions.find((t: any) => t.type === 'SELL')
    const res = await transactionsApi.DELETE(new Request(`http://localhost/api/transactions?id=${sellTx.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    const asset = await sqlite.get<any>("SELECT * FROM assets WHERE id = 'a-2330'")
    expect(asset.quantity).toBe(200)
  })

  it('transactions：symbol 前後空白仍可比對既有資產', async () => {
    const response = await transactionsApi.POST(
      json('/api/transactions', 'POST', {
        symbol: ' 2330.TW ', type: 'DIVIDEND', date: '2026-11-05', quantity: 1, price: 1,
      })
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.assetId).toBe('a-2330')
    await transactionsApi.DELETE(new Request(`http://localhost/api/transactions?id=${body.id}`, { method: 'DELETE' }))
  })

  it('SOXL 批次集合依 cyclePeakDate 篩選，且持倉歸零會重置批次', () => {
    const tranches = getExecutedTranchesSinceCyclePeak(
      [
        { type: 'BUY', quantity: 2, strategy_tranche: 4, date: '2026-10-31' },
        { type: 'BUY', quantity: 2, strategy_tranche: 2, date: '2026-11-01' },
        { type: 'SELL', quantity: 2, date: '2026-11-02' },
        { type: 'SELL', quantity: 2, date: '2026-11-03' },
        { type: 'BUY', quantity: 1, strategy_tranche: 1, date: '2026-11-04' },
      ],
      '2026-11-01',
      4
    )
    expect(tranches).toEqual([1])
  })

  it('portfolio PUT：只改幣別不會洗掉每月投入、緊急預備金、SOXL 參數', async () => {
    const res = await portfolioApi.PUT(json('/api/portfolio', 'PUT', { displayCurrency: 'USD' }))
    expect(res.status).toBe(200)
    const s = await sqlite.get<any>("SELECT * FROM portfolio_settings WHERE id = 'default'")
    expect(s.display_currency).toBe('USD')
    expect(s.exchange_rate).toBe(30)
    expect(s.monthly_investment_amount).toBe(45000)
    expect(s.emergency_fund_amount).toBe(250000)
    expect(s.soxl_max_position_percent).toBe(10)
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { exchangeRate: -1 }))).status).toBe(400)
  })

  it('portfolio PUT/GET：MSTR 淨負債、特別股、稀釋股數覆寫可局部讀寫', async () => {
    const getSettings = async () => (await (await portfolioApi.GET()).json()).settings

    // 預設值
    let s = await getSettings()
    expect(s.mstrNetDebtUsd).toBe(0)
    expect(s.mstrPreferredStockUsd).toBe(0)
    expect(s.mstrDilutedSharesOverride).toBeNull()

    // 只改淨負債：其他欄位不動
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { mstrNetDebtUsd: 8_200_000_000 }))).status).toBe(200)
    s = await getSettings()
    expect(s.mstrNetDebtUsd).toBe(8_200_000_000)
    expect(s.mstrPreferredStockUsd).toBe(0)
    expect(s.mstrDilutedSharesOverride).toBeNull()
    expect(s.monthlyInvestmentAmount).toBe(45000)

    // 再改特別股與稀釋股數：淨負債保留
    const res = await portfolioApi.PUT(
      json('/api/portfolio', 'PUT', { mstrPreferredStockUsd: 5_000_000_000, mstrDilutedSharesOverride: 300_000_000 })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).settings.mstrDilutedSharesOverride).toBe(300_000_000)
    s = await getSettings()
    expect(s.mstrNetDebtUsd).toBe(8_200_000_000)
    expect(s.mstrPreferredStockUsd).toBe(5_000_000_000)
    expect(s.mstrDilutedSharesOverride).toBe(300_000_000)

    // 只改幣別不會洗掉 MSTR 參數
    await portfolioApi.PUT(json('/api/portfolio', 'PUT', { displayCurrency: 'TWD' }))
    s = await getSettings()
    expect(s.mstrNetDebtUsd).toBe(8_200_000_000)
    expect(s.mstrDilutedSharesOverride).toBe(300_000_000)

    // 明確送 null 清除稀釋股數覆寫
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { mstrDilutedSharesOverride: null }))).status).toBe(200)
    s = await getSettings()
    expect(s.mstrDilutedSharesOverride).toBeNull()
    expect(s.mstrPreferredStockUsd).toBe(5_000_000_000)

    // 驗證：負數、0 股數 → 400，且不寫入
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { mstrNetDebtUsd: -1 }))).status).toBe(400)
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { mstrPreferredStockUsd: -5 }))).status).toBe(400)
    expect((await portfolioApi.PUT(json('/api/portfolio', 'PUT', { mstrDilutedSharesOverride: 0 }))).status).toBe(400)
    s = await getSettings()
    expect(s.mstrNetDebtUsd).toBe(8_200_000_000)
  })

  it('migrate：沒有 confirmOverwrite: true 一律拒絕，不會清空資料', async () => {
    const res = await migrateApi.POST(json('/api/migrate', 'POST', { categories: [{ name: 'X', assets: [] }] }))
    expect(res.status).toBe(400)
    const count = await sqlite.get<{ c: number }>('SELECT count(*) AS c FROM categories')
    expect(Number(count?.c)).toBe(2)
  })

  it('categories POST：沿用前端產生的合法 UUID，讓前後端 id 一致', async () => {
    const id = '3b241101-e2bb-4255-8caf-4136c566a962'
    const res = await categoriesApi.POST(json('/api/categories', 'POST', { id, name: '測試分類' }))
    expect((await res.json()).id).toBe(id)
    const bad = await (await categoriesApi.POST(json('/api/categories', 'POST', { id: 'not-a-uuid', name: '測試2' }))).json()
    expect(bad.id).not.toBe('not-a-uuid')
    await sqlite.run("DELETE FROM categories WHERE name IN ('測試分類', '測試2')")
  })

  it('SOXL 下單：讀系統設定匯率、結構化記錄批次、超過 10% 上限回 400、同批不可重複、超賣回 400', async () => {
    const cycleColumns = await sqlite.all<{ name: string }>('PRAGMA table_info(soxl_cycle_state)')
    expect(cycleColumns.map((column) => column.name)).toEqual([
      'id', 'cycle_peak', 'cycle_peak_date', 'sniper_activated_at', 'max_drawdown_since_peak', 'updated_at',
    ])
    // 總資產 = 2330 200 股 × 成本 610.05 TWD ÷ 30 + 現金 10,000 USD ≈ 14,067 USD；10% ≈ 1,406 USD
    const over = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'BUY', tranche: 1, quantity: 100, price: 20 }))
    expect(over.status).toBe(400)
    expect((await over.json()).error).toContain('上限')

    const noTranche = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'BUY', quantity: 10, price: 20 }))
    expect(noTranche.status).toBe(400)

    await sqlite.run(
      `INSERT INTO transactions (id, symbol, type, date, quantity, price, fee, currency, exchange_rate, strategy_tranche, created_at)
       VALUES ('old-soxl-tranche', 'SOXL', 'BUY', '2026-11-01', 2, 20, 0, 'USD', 30, 1, ?)`,
      [now]
    )
    await sqlite.run(
      `INSERT OR REPLACE INTO soxl_cycle_state (id, cycle_peak, cycle_peak_date, sniper_activated_at, max_drawdown_since_peak, updated_at)
       VALUES ('default', 100, '2026-11-02', NULL, 0, ?)`,
      [now]
    )

    const ok = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'BUY', tranche: 1, quantity: 15, price: 20 }))
    expect(ok.status).toBe(200)
    const okBody = await ok.json()
    expect(okBody.exchangeRate).toBe(30)
    const tx = await sqlite.get<any>('SELECT * FROM transactions WHERE id = ?', [okBody.transactionId])
    expect(tx.strategy_tranche).toBe(1)
    expect(tx.exchange_rate).toBe(30) // 不再寫死 32.5
    const soxl = await sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'SOXL'")
    expect(soxl.category_id).toBe('c-soxl') // 掛在既有 SOXL 分類，不是孤兒 'default_cat'
    expect(soxl.quantity).toBe(15)

    const dup = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'BUY', tranche: 1, quantity: 1, price: 20 }))
    expect(dup.status).toBe(409)

    const oversell = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'SELL', exitTier: 1, quantity: 16, price: 40 }))
    expect(oversell.status).toBe(400)

    const sell = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'SELL', exitTier: 1, quantity: 5, price: 40 }))
    expect(sell.status).toBe(200)
    expect((await sell.json()).realizedPnl).toBeCloseTo((40 - 20) * 5, 6)
  })

  it('違規覆寫：不符合當下規則必須填理由，並存下決策快照', async () => {
    soxlSnapshotSource.load = async () => ({
      ...PERMISSIVE_STATE,
      activeSignal: { ...PERMISSIVE_STATE.activeSignal, type: 'HOLD', title: '持有中' },
    })
    try {
      const noReason = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'SELL', quantity: 1, price: 40 }))
      expect(noReason.status).toBe(422)
      expect((await noReason.json()).error).toContain('覆寫理由')

      const ok = await soxlApi.POST(
        json('/api/strategy/soxl', 'POST', { action: 'SELL', quantity: 1, price: 40, overrideReason: '個人資金需求，提前部分減碼' })
      )
      expect(ok.status).toBe(200)
      expect((await ok.json()).override.isOverride).toBe(true)
      const sig = await sqlite.get<any>("SELECT * FROM strategy_signals WHERE status = 'OVERRIDDEN' ORDER BY created_at DESC LIMIT 1")
      expect(sig.trigger_condition).toContain('個人資金需求')
      const snap = JSON.parse(sig.indicator_values).snapshot
      expect(snap.signal.type).toBe('HOLD')
      expect(snap.override.reason).toBe('個人資金需求，提前部分減碼')
    } finally {
      soxlSnapshotSource.load = async () => PERMISSIVE_STATE
    }
  })

  it('策略參數 API：儲存後生效並同步上限，不合法回 400，可還原預設；決策歷史可讀', async () => {
    const bad = await strategySettingsApi.PUT(json('/api/strategy/settings', 'PUT', { config: { tranchePercent: 5, trancheCount: 4 } }))
    expect(bad.status).toBe(400)

    const put = await strategySettingsApi.PUT(json('/api/strategy/settings', 'PUT', { config: { maxPositionPercent: 8, intervalWeeks: 3 } }))
    expect(put.status).toBe(200)
    const got = await (await strategySettingsApi.GET()).json()
    expect(got.config.maxPositionPercent).toBe(8)
    expect(got.config.tranchePercent).toBe(2)
    expect(got.config.intervalWeeks).toBe(3)
    const ps = await sqlite.get<any>("SELECT soxl_max_position_percent AS m FROM portfolio_settings WHERE id = 'default'")
    expect(ps.m).toBe(8)

    const reset = await (await strategySettingsApi.PUT(json('/api/strategy/settings', 'PUT', { reset: true }))).json()
    expect(reset.config.maxPositionPercent).toBe(10)
    expect(reset.config.intervalWeeks).toBe(4)

    const hist = await (await signalsApi.GET(new Request('http://localhost/api/strategy/signals?limit=5'))).json()
    expect(hist.signals.length).toBeGreaterThan(0)
    expect(hist.signals.some((x: any) => x.status === 'OVERRIDDEN' && x.snapshot?.override?.reason)).toBe(true)
  })

  it('找不到 SOXL 分類時建立正式分類（不寫入孤兒 default_cat）', async () => {
    await sqlite.batch([
      { sql: "DELETE FROM assets WHERE symbol = 'SOXL'" },
      { sql: "UPDATE categories SET name = '美元現金' WHERE id = 'c-soxl'" },
    ])
    const res = await soxlApi.POST(json('/api/strategy/soxl', 'POST', { action: 'BUY', tranche: 2, quantity: 10, price: 20 }))
    expect(res.status).toBe(200)
    const soxl = await sqlite.get<any>("SELECT * FROM assets WHERE symbol = 'SOXL'")
    const cat = await sqlite.get<any>('SELECT * FROM categories WHERE id = ?', [soxl.category_id])
    expect(cat).toBeDefined()
    expect(cat.name).toContain('SOXL')
  })

  it('一次性遷移：舊預設 5% 上限與 1.25% 批次參數升級為 10% = 2.5% × 4', async () => {
    const cols = await sqlite.all<{ name: string }>('PRAGMA table_info(transactions)')
    expect(cols.some((c) => c.name === 'strategy_tranche')).toBe(true)

    await sqlite.batch([
      { sql: "DELETE FROM app_migrations WHERE id = '2026-11-20-soxl-10pct'" },
      { sql: "UPDATE portfolio_settings SET soxl_max_position_percent = 5.0 WHERE id = 'default'" },
      {
        sql: "INSERT OR REPLACE INTO strategy_settings (id, strategy_name, config_json, updated_at) VALUES ('soxl_sniper', 'x', ?, ?)",
        args: [JSON.stringify({ tranches: [{ tranche: 1, allocationPercent: 1.25 }] }), now],
      },
    ])
    await runMigrations()
    const s = await sqlite.get<any>("SELECT soxl_max_position_percent AS m FROM portfolio_settings WHERE id = 'default'")
    expect(s.m).toBe(10)
    const strat = JSON.parse((await sqlite.get<any>("SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'")).config_json)
    expect(strat.maxPositionPercent).toBe(10)
    expect(strat.tranchePercent).toBe(2.5)

    // 已執行過就不再動使用者之後的設定
    await sqlite.run("UPDATE portfolio_settings SET soxl_max_position_percent = 5.0 WHERE id = 'default'")
    await runMigrations()
    const s2 = await sqlite.get<any>("SELECT soxl_max_position_percent AS m FROM portfolio_settings WHERE id = 'default'")
    expect(s2.m).toBe(5)
  })
})
