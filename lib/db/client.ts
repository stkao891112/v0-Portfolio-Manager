import { createClient, type Client, type InValue, type ResultSet } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from './schema'
import fs from 'fs'
import path from 'path'

/**
 * 資料庫連線（Turso 雲端 SQLite，與原本 SQLite 語法相容）
 *
 * - 有設定 TURSO_DATABASE_URL（Vercel 或本機 .env.local）→ 連雲端資料庫
 * - 本機沒設定 → 退回使用專案內 data/portfolio.db 檔案
 * - 在 Vercel 上沒設定 → 直接報錯提示（Vercel 不能寫入本機檔案）
 *
 * 連線採「第一次用到才建立」，避免建置（next build）時就去連資料庫。
 */

type Row = Record<string, any>
type Args = ReadonlyArray<InValue | undefined>

function resolveConfig(): { url: string; authToken?: string } {
  const url =
    process.env.TURSO_DATABASE_URL || process.env.TURSO_CONNECTION_URL || process.env.LIBSQL_URL
  if (url) {
    ensureLocalDir(url)
    return {
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined,
    }
  }

  if (process.env.VERCEL) {
    throw new Error(
      '尚未設定雲端資料庫：請在 Vercel 專案的環境變數設定 TURSO_DATABASE_URL 與 TURSO_AUTH_TOKEN'
    )
  }

  const localUrl = 'file:data/portfolio.db'
  ensureLocalDir(localUrl)
  return { url: localUrl }
}

/** 使用本機檔案（file:）時，先確認資料夾存在 */
function ensureLocalDir(url: string): void {
  if (!url.startsWith('file:')) return
  const filePath = url.slice('file:'.length).replace(/^\/\/(?=\/)/, '')
  if (!filePath || filePath === ':memory:') return
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

let clientInstance: Client | null = null
let dbInstance: LibSQLDatabase<typeof schema> | null = null

export function getClient(): Client {
  if (!clientInstance) {
    clientInstance = createClient(resolveConfig())
  }
  return clientInstance
}

/** Drizzle ORM（型別安全查詢） */
export function getDb(): LibSQLDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getClient(), { schema })
  }
  return dbInstance
}

/** libsql 不接受 undefined，統一轉成 null（與原本 better-sqlite3 寫法相容） */
function normalizeArgs(args: Args = []): InValue[] {
  return args.map((v) => (v === undefined ? null : v))
}

/** 把查詢結果轉成一般物件 { 欄位名稱: 值 } */
function toObjects<T>(rs: ResultSet): T[] {
  return rs.rows.map((row) => {
    const obj: Row = {}
    rs.columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj as T
  })
}

export interface Statement {
  sql: string
  args?: Args
}

/**
 * 直接下 SQL 的小工具（取代原本 better-sqlite3 的 prepare().run/get/all）
 * 全部是非同步，呼叫時要加 await。
 */
export const sqlite = {
  /** 執行寫入（INSERT / UPDATE / DELETE） */
  async run(sql: string, args?: Args): Promise<ResultSet> {
    return getClient().execute({ sql, args: normalizeArgs(args) })
  },

  /** 取第一筆，沒有資料回傳 undefined */
  async get<T = Row>(sql: string, args?: Args): Promise<T | undefined> {
    const rs = await getClient().execute({ sql, args: normalizeArgs(args) })
    return toObjects<T>(rs)[0]
  },

  /** 取全部 */
  async all<T = Row>(sql: string, args?: Args): Promise<T[]> {
    const rs = await getClient().execute({ sql, args: normalizeArgs(args) })
    return toObjects<T>(rs)
  },

  /** 一次執行多個寫入，全部成功或全部不生效（取代原本的 transaction） */
  async batch(statements: Statement[]): Promise<ResultSet[]> {
    if (statements.length === 0) return []
    return getClient().batch(
      statements.map((s) => ({ sql: s.sql, args: normalizeArgs(s.args) })),
      'write'
    )
  },

  /** 執行多段 SQL（建立資料表用，不能帶參數） */
  async exec(sql: string): Promise<void> {
    await getClient().executeMultiple(sql)
  },
}
