import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * 回報目前實際使用的資料庫（給畫面標示用，不回傳任何連線字串或金鑰）
 * - cloud：有設定 TURSO_DATABASE_URL（Vercel 或本機 .env.local）
 * - local：沒設定，使用專案內 data/portfolio.db
 */
export async function GET() {
  const cloud = Boolean(
    process.env.TURSO_DATABASE_URL || process.env.TURSO_CONNECTION_URL || process.env.LIBSQL_URL
  )
  return NextResponse.json({ mode: cloud ? 'cloud' : 'local' })
}
