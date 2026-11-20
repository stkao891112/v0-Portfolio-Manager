'use client'

import { useEffect, useState } from 'react'

export type DbMode = 'cloud' | 'local' | null

/** 讀取目前實際使用的資料庫：Turso 雲端或本機檔案 */
export function useDbMode(): DbMode {
  const [mode, setMode] = useState<DbMode>(null)
  useEffect(() => {
    fetch('/api/db-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMode(j?.mode === 'cloud' ? 'cloud' : j?.mode === 'local' ? 'local' : null))
      .catch(() => setMode(null))
  }, [])
  return mode
}

export const DB_LABEL: Record<'cloud' | 'local', { short: string; long: string }> = {
  cloud: { short: 'Turso 雲端', long: '資料儲存於 Turso 雲端資料庫，電腦與手機同步' },
  local: { short: '本機資料庫', long: '資料儲存於本機 ./data/portfolio.db（未設定雲端資料庫）' },
}
