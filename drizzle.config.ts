import { defineConfig } from 'drizzle-kit'

// 有設定 TURSO_DATABASE_URL 就連雲端資料庫，否則用本機 data/portfolio.db
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL || 'file:data/portfolio.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
