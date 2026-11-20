import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // 資料庫測試共用 data/test.db，避免多檔同時寫入互相干擾
    fileParallelism: false,
  },
})
