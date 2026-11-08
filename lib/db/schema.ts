import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const portfolioSettings = sqliteTable('portfolio_settings', {
  id: text('id').primaryKey(), // 'default'
  displayCurrency: text('display_currency').notNull().default('TWD'), // 'TWD' | 'USD'
  exchangeRate: real('exchange_rate').notNull().default(32.5),
  monthlyInvestmentAmount: real('monthly_investment_amount').notNull().default(20000),
  emergencyFundAmount: real('emergency_fund_amount').notNull().default(0),
  soxlReserveTargetPercent: real('soxl_reserve_target_percent').notNull().default(10.0),
  soxlMaxPositionPercent: real('soxl_max_position_percent').notNull().default(5.0),
  updatedAt: text('updated_at').notNull(),
})

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  targetPercent: real('target_percent').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  name: text('name'),
  targetPercent: real('target_percent').notNull().default(0),
  quantity: real('quantity').notNull().default(0),
  costPerUnit: real('cost_per_unit').notNull().default(0),
  currency: text('currency').notNull().default('TWD'), // 'TWD' | 'USD'
  currentPrice: real('current_price'),
  priceUpdatedAt: text('price_updated_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').references(() => assets.id, { onDelete: 'set null' }),
  symbol: text('symbol').notNull(),
  type: text('type').notNull(), // 'BUY' | 'SELL' | 'DIVIDEND' | 'INITIAL_BALANCE'
  date: text('date').notNull(),
  quantity: real('quantity').notNull(),
  price: real('price').notNull(),
  fee: real('fee').notNull().default(0),
  currency: text('currency').notNull().default('TWD'),
  exchangeRate: real('exchange_rate').notNull().default(1.0),
  realizedPnl: real('realized_pnl'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
})

export const strategySettings = sqliteTable('strategy_settings', {
  id: text('id').primaryKey(), // 'soxl_sniper' | 'btc_mstr'
  strategyName: text('strategy_name').notNull(),
  configJson: text('config_json').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const strategySignals = sqliteTable('strategy_signals', {
  id: text('id').primaryKey(),
  strategyName: text('strategy_name').notNull(),
  signalType: text('signal_type').notNull(), // 'BUY_CANDIDATE' | 'SELL_CANDIDATE' | 'HOLD' | 'WAIT' | 'WARNING' | 'MANUAL_REVIEW_REQUIRED'
  symbol: text('symbol').notNull(),
  price: real('price').notNull(),
  indicatorValues: text('indicator_values'), // JSON
  triggerCondition: text('trigger_condition').notNull(),
  recommendedAction: text('recommended_action').notNull(),
  isConfirmed: integer('is_confirmed').notNull().default(0), // 1 = closed weekly, 0 = intraday unconfirmed
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'EXECUTED' | 'DISMISSED'
  createdAt: text('created_at').notNull(),
  executedAt: text('executed_at'),
})

export const marketPrices = sqliteTable('market_prices', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull().unique(),
  price: real('price').notNull(),
  change24h: real('change_24h'),
  volume: real('volume'),
  isStale: integer('is_stale').notNull().default(0),
  timestamp: text('timestamp').notNull(),
})

export const weeklySnapshots = sqliteTable('weekly_snapshots', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  weekEndDate: text('week_end_date').notNull(),
  open: real('open').notNull(),
  high: real('high').notNull(),
  low: real('low').notNull(),
  close: real('close').notNull(),
  volume: real('volume'),
  ma10w: real('ma_10w'),
  ma40w: real('ma_40w'),
  cyclePeak: real('cycle_peak'),
  drawdownPercent: real('drawdown_percent'),
  isClosed: integer('is_closed').notNull().default(1),
  createdAt: text('created_at').notNull(),
})
