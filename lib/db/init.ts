import { sqlite, type Statement } from './client'
import { DEFAULT_SOXL_CONFIG, buildSoxlStrategySettingsJson } from '../strategies/config'

/** portfolio_settings 的預設值（API 與種子資料共用） */
export const DEFAULT_PORTFOLIO_SETTINGS = {
  displayCurrency: 'TWD' as 'TWD' | 'USD',
  exchangeRate: 32.5,
  monthlyInvestmentAmount: 20000,
  emergencyFundAmount: 0,
  soxlReserveTargetPercent: DEFAULT_SOXL_CONFIG.maxPositionPercent,
  soxlMaxPositionPercent: DEFAULT_SOXL_CONFIG.maxPositionPercent,
}

// 同一個執行環境只建表一次（雲端資料庫每次查詢都要走網路，避免重複送出建表指令）
let tablesReady: Promise<void> | null = null

export function ensureTablesExist(): Promise<void> {
  if (!tablesReady) {
    tablesReady = createTables().catch((err) => {
      tablesReady = null
      throw err
    })
  }
  return tablesReady
}

async function createTables(): Promise<void> {
  await sqlite.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_settings (
      id TEXT PRIMARY KEY,
      display_currency TEXT NOT NULL DEFAULT 'TWD',
      exchange_rate REAL NOT NULL DEFAULT 32.5,
      monthly_investment_amount REAL NOT NULL DEFAULT 20000,
      emergency_fund_amount REAL NOT NULL DEFAULT 0,
      soxl_reserve_target_percent REAL NOT NULL DEFAULT 10.0,
      soxl_max_position_percent REAL NOT NULL DEFAULT 10.0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      target_percent REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT,
      target_percent REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'TWD',
      current_price REAL,
      price_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      asset_id TEXT,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'TWD',
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      realized_pnl REAL,
      notes TEXT,
      strategy_tranche INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_settings (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_signals (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      indicator_values TEXT,
      trigger_condition TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      executed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS market_prices (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      price REAL NOT NULL,
      change_24h REAL,
      volume REAL,
      is_stale INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_snapshots (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      week_end_date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      ma_10w REAL,
      ma_40w REAL,
      cycle_peak REAL,
      drawdown_percent REAL,
      is_closed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
  await runMigrations()
}

/**
 * 既有資料庫的結構／資料升級（每個 id 只執行一次，記錄在 app_migrations）
 */
export async function runMigrations(): Promise<void> {
  // 1. transactions 加 strategy_tranche 欄位（舊資料庫建表時沒有）
  const cols = await sqlite.all<{ name: string }>('PRAGMA table_info(transactions)')
  if (!cols.some((c) => c.name === 'strategy_tranche')) {
    try {
      await sqlite.run('ALTER TABLE transactions ADD COLUMN strategy_tranche INTEGER')
    } catch (err: any) {
      // 另一個執行環境剛好同時加好了欄位 → 忽略
      if (!/duplicate column/i.test(String(err?.message))) throw err
    }
  }

  const applied = new Set(
    (await sqlite.all<{ id: string }>('SELECT id FROM app_migrations')).map((r) => r.id)
  )
  const now = new Date().toISOString()

  // 2. 2026-11-20 定案：SOXL 上限 10%（= 2.5% × 4 批）。
  //    舊版預設把 soxl_max_position_percent 寫成 5.0（介面上沒有地方能改，屬於舊預設值而非使用者設定），
  //    strategy_settings 的 soxl_sniper 仍是每批 1.25% 的舊參數 → 一次性升級為新預設。
  const MIGRATION_SOXL_10 = '2026-11-20-soxl-10pct'
  if (!applied.has(MIGRATION_SOXL_10)) {
    const statements: Statement[] = [
      {
        sql: 'UPDATE portfolio_settings SET soxl_max_position_percent = ?, updated_at = ? WHERE soxl_max_position_percent = 5.0',
        args: [DEFAULT_SOXL_CONFIG.maxPositionPercent, now],
      },
    ]
    const row = await sqlite.get<{ config_json: string }>(
      "SELECT config_json FROM strategy_settings WHERE id = 'soxl_sniper'"
    )
    let legacy = false
    if (row) {
      try {
        const parsed = JSON.parse(row.config_json)
        legacy =
          parsed.maxPositionPercent === undefined &&
          Array.isArray(parsed.tranches) &&
          parsed.tranches.some((t: any) => t?.allocationPercent === 1.25)
      } catch {
        legacy = true
      }
    }
    if (legacy) {
      statements.push({
        sql: "UPDATE strategy_settings SET config_json = ?, updated_at = ? WHERE id = 'soxl_sniper'",
        args: [JSON.stringify(buildSoxlStrategySettingsJson()), now],
      })
    }
    statements.push({ sql: 'INSERT OR IGNORE INTO app_migrations (id, applied_at) VALUES (?, ?)', args: [MIGRATION_SOXL_10, now] })
    await sqlite.batch(statements)
  }
}

// 同一個執行環境同時有多個請求時，只跑一次預設資料建立
let seeding: Promise<boolean> | null = null

export function seedDefaultPortfolioIfEmpty(): Promise<boolean> {
  if (!seeding) {
    seeding = seedIfEmpty().finally(() => {
      seeding = null
    })
  }
  return seeding
}

async function seedIfEmpty(): Promise<boolean> {
  await ensureTablesExist()

  // Check if categories already exist
  const existing = await sqlite.get<{ count: number }>('SELECT count(*) as count FROM categories')
  if (Number(existing?.count ?? 0) > 0) {
    return false // Already initialized
  }

  const now = new Date().toISOString()
  const statements: Statement[] = []

  // 1. Seed portfolio_settings
  statements.push({
    sql: `
      INSERT OR IGNORE INTO portfolio_settings (
        id, display_currency, exchange_rate, monthly_investment_amount,
        emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      'default',
      DEFAULT_PORTFOLIO_SETTINGS.displayCurrency,
      DEFAULT_PORTFOLIO_SETTINGS.exchangeRate,
      DEFAULT_PORTFOLIO_SETTINGS.monthlyInvestmentAmount,
      DEFAULT_PORTFOLIO_SETTINGS.emergencyFundAmount,
      DEFAULT_PORTFOLIO_SETTINGS.soxlReserveTargetPercent,
      DEFAULT_PORTFOLIO_SETTINGS.soxlMaxPositionPercent,
      now,
    ],
  })

  // 2. Seed default categories and assets according to user/ChatGPT blueprint
  const defaultBlueprint = [
    {
      name: '台股主力',
      color: 'oklch(0.72 0.19 180)', // Cyan
      sortOrder: 1,
      targetPercent: 25,
      assets: [
        { symbol: '2330.TW', name: '台積電', targetPercent: 10, currency: 'TWD' },
        { symbol: '00935.TW', name: '野村臺灣新科技50', targetPercent: 15, currency: 'TWD' },
      ],
    },
    {
      name: '美股核心',
      color: 'oklch(0.65 0.18 280)', // Purple
      sortOrder: 2,
      targetPercent: 30,
      assets: [
        { symbol: '00662.TW', name: '富邦NASDAQ (00662)', targetPercent: 30, currency: 'TWD' },
      ],
    },
    {
      name: 'SOXL 機會預備金',
      color: 'oklch(0.70 0.16 50)', // Orange
      sortOrder: 3,
      targetPercent: 10,
      assets: [
        { symbol: 'SOXL', name: `半導體三倍槓桿 (最大${DEFAULT_SOXL_CONFIG.maxPositionPercent}%)`, targetPercent: 0, currency: 'USD' },
        { symbol: 'SOXL_CASH_BUFFER', name: '美元預備金現金緩衝', targetPercent: 10, currency: 'USD' },
      ],
    },
    {
      name: '加密貨幣',
      color: 'oklch(0.75 0.15 140)', // Green
      sortOrder: 4,
      targetPercent: 25,
      assets: [
        { symbol: 'BTC', name: '比特幣 (BTC)', targetPercent: 12.5, currency: 'USD' },
        { symbol: 'MSTR', name: 'MicroStrategy (MSTR)', targetPercent: 12.5, currency: 'USD' },
      ],
    },
    {
      name: '現金流工具',
      color: 'oklch(0.70 0.18 220)', // Blue
      sortOrder: 5,
      targetPercent: 10,
      assets: [
        { symbol: 'CASH_FLOW', name: '自訂現金流資產 / 活存', targetPercent: 10, currency: 'TWD' },
      ],
    },
  ]

  // 預設資料使用固定 ID + INSERT OR IGNORE：就算兩個請求同時建立，也不會產生重複的類別
  const insertCategorySql = `
    INSERT OR IGNORE INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `

  const insertAssetSql = `
    INSERT OR IGNORE INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `

  for (const cat of defaultBlueprint) {
    const catId = `seed-cat-${cat.sortOrder}`
    statements.push({
      sql: insertCategorySql,
      args: [catId, cat.name, cat.color, cat.sortOrder, cat.targetPercent, now, now],
    })

    for (const a of cat.assets) {
      const assetId = `seed-asset-${a.symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`
      statements.push({
        sql: insertAssetSql,
        args: [assetId, catId, a.symbol, a.name, a.targetPercent, 0, 0, a.currency, now, now],
      })
    }
  }

  // 3. Seed Strategy Settings
  // INSERT OR IGNORE：不覆蓋使用者已調整過的策略參數
  const insertStrategySettingSql = `
    INSERT OR IGNORE INTO strategy_settings (id, strategy_name, config_json, updated_at)
    VALUES (?, ?, ?, ?)
  `

  const insertStrategySetting = (...args: [string, string, string, string]) => {
    statements.push({ sql: insertStrategySettingSql, args })
  }

  insertStrategySetting(
    'soxl_sniper',
    'SOXL 熊市狙擊策略',
    JSON.stringify(buildSoxlStrategySettingsJson()),
    now
  )

  insertStrategySetting(
    'btc_mstr',
    'BTC/MSTR 週期輪動策略',
    JSON.stringify({
      currentPhase: 'BULL_MID',
      phases: {
        BULL_EARLY: { label: '牛市初期', mstrRatio: 0.7, btcRatio: 0.3 },
        BULL_MID: { label: '牛市中期', mstrRatio: 0.5, btcRatio: 0.5 },
        BULL_LATE: { label: '牛市後期', mstrRatio: 0.3, btcRatio: 0.7 },
        BEAR_WAITING: { label: '熊市等待期', mstrRatio: 0.0, btcRatio: 1.0 },
      },
    }),
    now
  )

  // 全部一次寫入（全部成功或全部不生效）
  await sqlite.batch(statements)
  return true
}
