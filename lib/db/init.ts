import { sqlite } from './client'
import { v4 as uuidv4 } from 'uuid'

export function ensureTablesExist() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_settings (
      id TEXT PRIMARY KEY,
      display_currency TEXT NOT NULL DEFAULT 'TWD',
      exchange_rate REAL NOT NULL DEFAULT 32.5,
      monthly_investment_amount REAL NOT NULL DEFAULT 20000,
      emergency_fund_amount REAL NOT NULL DEFAULT 0,
      soxl_reserve_target_percent REAL NOT NULL DEFAULT 10.0,
      soxl_max_position_percent REAL NOT NULL DEFAULT 5.0,
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
  `)
}

export function seedDefaultPortfolioIfEmpty() {
  ensureTablesExist()

  // Check if categories already exist
  const existingCount = sqlite.prepare('SELECT count(*) as count FROM categories').get() as { count: number }
  if (existingCount.count > 0) {
    return false // Already initialized
  }

  const now = new Date().toISOString()

  // 1. Seed portfolio_settings
  sqlite.prepare(`
    INSERT OR REPLACE INTO portfolio_settings (
      id, display_currency, exchange_rate, monthly_investment_amount,
      emergency_fund_amount, soxl_reserve_target_percent, soxl_max_position_percent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('default', 'TWD', 32.5, 20000, 0, 10.0, 5.0, now)

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
        { symbol: 'SOXL', name: '半導體三倍槓桿 (最大5%)', targetPercent: 0, currency: 'USD' },
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

  const insertCategory = sqlite.prepare(`
    INSERT INTO categories (id, name, color, sort_order, target_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAsset = sqlite.prepare(`
    INSERT INTO assets (id, category_id, symbol, name, target_percent, quantity, cost_per_unit, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const cat of defaultBlueprint) {
    const catId = uuidv4()
    insertCategory.run(catId, cat.name, cat.color, cat.sortOrder, cat.targetPercent, now, now)

    for (const a of cat.assets) {
      const assetId = uuidv4()
      insertAsset.run(assetId, catId, a.symbol, a.name, a.targetPercent, 0, 0, a.currency, now, now)
    }
  }

  // 3. Seed Strategy Settings
  const insertStrategySetting = sqlite.prepare(`
    INSERT OR REPLACE INTO strategy_settings (id, strategy_name, config_json, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  insertStrategySetting.run(
    'soxl_sniper',
    'SOXL 熊市狙擊策略',
    JSON.stringify({
      cyclePeakSoxx: 320.0,
      cycleAnchorDate: '2024-07-11',
      tranches: [
        { tranche: 1, triggerDrawdown: -40, allocationPercent: 1.25, status: 'WAITING', label: '第一批候選區 (-40%)' },
        { tranche: 2, triggerDrawdown: -45, allocationPercent: 1.25, status: 'WAITING', label: '第二批候選區 (-45%)' },
        { tranche: 3, triggerDrawdown: -50, allocationPercent: 1.25, status: 'WAITING', label: '第三批候選區 (-50%)' },
        { tranche: 4, triggerDrawdown: -40, requireMa10Break: true, allocationPercent: 1.25, status: 'WAITING', label: '第四批突破買入 (站回10W MA)' },
      ],
      exits: [
        { tier: 1, returnRate: 0.8, sellRatio: 0.3333, label: '獲利 +80% (賣出 1/3)' },
        { tier: 2, returnRate: 1.5, cumulativeSellRatio: 0.6667, label: '獲利 +150% (累計賣出 2/3)' },
        { tier: 3, returnRate: 2.0, sellAll: true, label: '獲利 +200% (全數清空)' },
      ],
      stopLossMa40Weeks: 2, // SOXX 連續兩週跌破 40W MA 警告退出
    }),
    now
  )

  insertStrategySetting.run(
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

  return true
}
