import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

const dataDir = path.join(process.cwd(), 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = path.join(dataDir, 'portfolio.db')

// Singleton connection
let sqliteInstance: Database.Database | null = null

function getSqliteInstance(): Database.Database {
  if (!sqliteInstance) {
    sqliteInstance = new Database(dbPath)
    sqliteInstance.pragma('journal_mode = WAL')
    sqliteInstance.pragma('foreign_keys = ON')
  }
  return sqliteInstance
}

export const sqlite = getSqliteInstance()
export const db = drizzle(sqlite, { schema })
