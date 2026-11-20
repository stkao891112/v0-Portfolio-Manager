'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { Category, Asset, Currency, getNextColor } from './portfolio-types'
import { isCashLikeSymbol } from './valuation'

/**
 * 單一真相來源：分類與資產一律以資料庫為準（/api/portfolio），
 * localStorage 只保留純 UI 偏好（顯示幣別），不再持久化 categories，避免兩份資料互相覆蓋。
 *
 * 寫入一律「樂觀更新 → 等 API 結果 → 失敗就回滾並跳出錯誤提示」，不再 .catch(() => {}) 靜默吞錯。
 */

interface PortfolioStore {
  categories: Category[]
  displayCurrency: Currency
  exchangeRate: number // 1 USD = X TWD
  isDbConnected: boolean
  isSyncing: boolean
  /** 最近一次成功取得報價的時間（ISO） */
  quotesFetchedAt: string | null
  /** 最近一次報價失敗的代號 */
  quoteErrors: string[]
  isRefreshingQuotes: boolean
  syncWithDatabase: () => Promise<boolean>
  refreshQuotes: () => Promise<boolean>
  /** 「刷新」按鈕：重新讀資料庫 + 更新全部持倉報價 */
  refreshAll: () => Promise<void>
  /** 系統設定頁儲存成功後，把伺服器回傳的設定同步進來 */
  applySettings: (settings: { displayCurrency?: Currency; exchangeRate?: number }) => void
  setDisplayCurrency: (currency: Currency) => Promise<boolean>
  setExchangeRate: (rate: number) => Promise<boolean>
  addCategory: (name: string) => Promise<boolean>
  removeCategory: (id: string) => Promise<boolean>
  updateCategory: (id: string, name: string) => Promise<boolean>
  addAsset: (
    categoryId: string,
    symbol: string,
    targetPercent: number,
    currency: Currency,
    quantity?: number,
    costPerUnit?: number
  ) => Promise<boolean>
  removeAsset: (categoryId: string, assetId: string) => Promise<boolean>
  restoreAsset: (categoryId: string, asset: Asset, index?: number) => Promise<boolean>
  updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => Promise<boolean>
  convertToDisplayCurrency: (value: number, fromCurrency: Currency) => number
}

/** 呼叫寫入 API；HTTP 非 2xx 時丟出帶伺服器錯誤訊息的 Error */
async function apiWrite<T = any>(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('無法連線到伺服器')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `伺服器錯誤（HTTP ${res.status}）`)
  return data as T
}

const fail = (action: string, err: unknown) => {
  toast.error(`${action}失敗，已還原畫面`, { description: err instanceof Error ? err.message : String(err) })
  return false
}

/** 把資料庫回傳的資產轉成前端型別（null → undefined、數字轉型） */
function normalizeCategories(raw: any[]): Category[] {
  return (raw || []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    targetPercent: c.targetPercent ?? undefined,
    assets: (c.assets || []).map((a: any) => ({
      id: a.id,
      symbol: a.symbol,
      name: a.name ?? undefined,
      targetPercent: Number(a.targetPercent) || 0,
      quantity: Number(a.quantity) || 0,
      costPerUnit: Number(a.costPerUnit) || 0,
      currency: (a.currency === 'TWD' ? 'TWD' : 'USD') as Currency,
      currentPrice: a.currentPrice != null ? Number(a.currentPrice) : undefined,
      priceUpdatedAt: a.priceUpdatedAt ?? undefined,
    })),
  }))
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => {
      /** 只回滾某個分類（避免整包還原蓋掉同時進行的其他修改） */
      const replaceCategory = (cat: Category) =>
        set((state) => ({ categories: state.categories.map((c) => (c.id === cat.id ? cat : c)) }))

      return {
        categories: [],
        displayCurrency: 'TWD',
        exchangeRate: 32.5,
        isDbConnected: false,
        isSyncing: false,
        quotesFetchedAt: null,
        quoteErrors: [],
        isRefreshingQuotes: false,

        syncWithDatabase: async () => {
          set({ isSyncing: true })
          try {
            const res = await fetch('/api/portfolio', { cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            // 資料庫為唯一真相來源：空的就顯示空的，絕不自動拿本機資料去覆蓋資料庫
            set({
              categories: normalizeCategories(data.categories),
              displayCurrency: data.settings?.displayCurrency || get().displayCurrency,
              exchangeRate: Number(data.settings?.exchangeRate) > 0 ? Number(data.settings.exchangeRate) : get().exchangeRate,
              isDbConnected: true,
            })
            return true
          } catch (err) {
            set({ isDbConnected: false })
            toast.error('讀取資料庫失敗', { description: err instanceof Error ? err.message : String(err) })
            return false
          } finally {
            set({ isSyncing: false })
          }
        },

        refreshQuotes: async () => {
          const symbols = Array.from(
            new Set(
              get()
                .categories.flatMap((c) => c.assets.map((a) => a.symbol.toUpperCase()))
                .filter((s) => s && !isCashLikeSymbol(s))
            )
          )
          if (symbols.length === 0) return true
          set({ isRefreshingQuotes: true })
          try {
            const res = await fetch(`/api/market-data/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, {
              cache: 'no-store',
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            const quotes: Record<string, { price: number; timestamp: string; isStale: boolean }> = data.quotes || {}
            set((state) => ({
              categories: state.categories.map((c) => ({
                ...c,
                assets: c.assets.map((a) => {
                  const q = quotes[a.symbol.toUpperCase()]
                  return q && q.price > 0 ? { ...a, currentPrice: q.price, priceUpdatedAt: q.timestamp } : a
                }),
              })),
              quotesFetchedAt: data.fetchedAt || new Date().toISOString(),
              quoteErrors: Object.keys(data.errors || {}),
            }))
            const failed = Object.keys(data.errors || {})
            if (failed.length) {
              toast.warning(`${failed.length} 個標的抓不到報價，暫以成本價估值`, { description: failed.join('、') })
            }
            return true
          } catch (err) {
            toast.error('更新報價失敗，暫以最後一次報價或成本價估值', {
              description: err instanceof Error ? err.message : String(err),
            })
            return false
          } finally {
            set({ isRefreshingQuotes: false })
          }
        },

        refreshAll: async () => {
          const ok = await get().syncWithDatabase()
          if (ok) await get().refreshQuotes()
        },

        applySettings: (settings) => {
          set((state) => ({
            displayCurrency: settings.displayCurrency ?? state.displayCurrency,
            exchangeRate: settings.exchangeRate && settings.exchangeRate > 0 ? settings.exchangeRate : state.exchangeRate,
          }))
        },

        setDisplayCurrency: async (currency: Currency) => {
          const prev = get().displayCurrency
          set({ displayCurrency: currency })
          try {
            // 只送有改的欄位（伺服器做局部更新，不會洗掉其他設定）
            await apiWrite('/api/portfolio', 'PUT', { displayCurrency: currency })
            return true
          } catch (err) {
            set({ displayCurrency: prev })
            return fail('儲存顯示幣別', err)
          }
        },

        setExchangeRate: async (rate: number) => {
          const prev = get().exchangeRate
          set({ exchangeRate: rate })
          try {
            await apiWrite('/api/portfolio', 'PUT', { exchangeRate: rate })
            return true
          } catch (err) {
            set({ exchangeRate: prev })
            return fail('儲存匯率', err)
          }
        },

        convertToDisplayCurrency: (value: number, fromCurrency: Currency) => {
          const { displayCurrency, exchangeRate } = get()
          if (fromCurrency === displayCurrency) return value
          if (fromCurrency === 'USD' && displayCurrency === 'TWD') {
            return value * exchangeRate
          }
          if (fromCurrency === 'TWD' && displayCurrency === 'USD') {
            return value / exchangeRate
          }
          return value
        },

        addCategory: async (name: string) => {
          const usedColors = get().categories.map((c) => c.color)
          const color = getNextColor(usedColors)
          const tempId = uuidv4()
          set((state) => ({ categories: [...state.categories, { id: tempId, name, color, assets: [] }] }))
          try {
            const data = await apiWrite<{ id: string }>('/api/categories', 'POST', { id: tempId, name, color })
            // 以後端實際寫入的 id 為準，避免前後端 id 脫鉤（之後新增資產、刪除才找得到）
            if (data.id && data.id !== tempId) {
              set((state) => ({
                categories: state.categories.map((c) => (c.id === tempId ? { ...c, id: data.id } : c)),
              }))
            }
            return true
          } catch (err) {
            set((state) => ({ categories: state.categories.filter((c) => c.id !== tempId) }))
            return fail('新增分類', err)
          }
        },

        removeCategory: async (id: string) => {
          const prev = get().categories
          const idx = prev.findIndex((c) => c.id === id)
          const removed = prev[idx]
          set((state) => ({ categories: state.categories.filter((c) => c.id !== id) }))
          try {
            await apiWrite(`/api/categories?id=${encodeURIComponent(id)}`, 'DELETE')
            return true
          } catch (err) {
            if (removed) {
              set((state) => {
                const cats = [...state.categories]
                cats.splice(Math.min(idx, cats.length), 0, removed)
                return { categories: cats }
              })
            }
            return fail('刪除分類', err)
          }
        },

        updateCategory: async (id: string, name: string) => {
          const before = get().categories.find((c) => c.id === id)
          set((state) => ({
            categories: state.categories.map((c) => (c.id === id ? { ...c, name } : c)),
          }))
          try {
            await apiWrite('/api/categories', 'PUT', { id, name })
            return true
          } catch (err) {
            if (before) replaceCategory(before)
            return fail('更新分類名稱', err)
          }
        },

        addAsset: async (categoryId, symbol, targetPercent, currency, quantity = 0, costPerUnit = 0) => {
          const tempId = uuidv4()
          const sym = symbol.trim().toUpperCase()
          set((state) => ({
            categories: state.categories.map((c) =>
              c.id === categoryId
                ? {
                    ...c,
                    assets: [...c.assets, { id: tempId, symbol: sym, targetPercent, quantity, costPerUnit, currency }],
                  }
                : c
            ),
          }))
          try {
            const data = await apiWrite<{ id: string }>('/api/assets', 'POST', {
              id: tempId,
              categoryId,
              symbol: sym,
              targetPercent,
              currency,
              quantity,
              costPerUnit,
            })
            if (data.id && data.id !== tempId) {
              set((state) => ({
                categories: state.categories.map((c) =>
                  c.id === categoryId
                    ? { ...c, assets: c.assets.map((a) => (a.id === tempId ? { ...a, id: data.id } : a)) }
                    : c
                ),
              }))
            }
            // 新標的立即抓一次報價
            if (!isCashLikeSymbol(sym)) void get().refreshQuotes()
            return true
          } catch (err) {
            set((state) => ({
              categories: state.categories.map((c) =>
                c.id === categoryId ? { ...c, assets: c.assets.filter((a) => a.id !== tempId) } : c
              ),
            }))
            return fail('新增標的', err)
          }
        },

        removeAsset: async (categoryId: string, assetId: string) => {
          const before = get().categories.find((c) => c.id === categoryId)
          set((state) => ({
            categories: state.categories.map((c) =>
              c.id === categoryId ? { ...c, assets: c.assets.filter((a) => a.id !== assetId) } : c
            ),
          }))
          try {
            await apiWrite(`/api/assets?id=${encodeURIComponent(assetId)}`, 'DELETE')
            return true
          } catch (err) {
            if (before) replaceCategory(before)
            return fail('刪除標的', err)
          }
        },

        restoreAsset: async (categoryId: string, asset: Asset, index?: number) => {
          set((state) => ({
            categories: state.categories.map((c) => {
              if (c.id !== categoryId) return c
              const assets = c.assets.filter((a) => a.id !== asset.id)
              if (typeof index === 'number' && index >= 0 && index <= assets.length) {
                assets.splice(index, 0, asset)
              } else {
                assets.push(asset)
              }
              return { ...c, assets }
            }),
          }))
          try {
            // 寫回資料庫（沿用原 id，並接回刪除時解除關聯的交易紀錄），重新整理後也不會消失
            await apiWrite('/api/assets', 'POST', {
              id: asset.id,
              restore: true,
              categoryId,
              symbol: asset.symbol,
              name: asset.name,
              targetPercent: asset.targetPercent,
              quantity: asset.quantity,
              costPerUnit: asset.costPerUnit,
              currency: asset.currency,
              currentPrice: asset.currentPrice,
              priceUpdatedAt: asset.priceUpdatedAt,
            })
            return true
          } catch (err) {
            set((state) => ({
              categories: state.categories.map((c) =>
                c.id === categoryId ? { ...c, assets: c.assets.filter((a) => a.id !== asset.id) } : c
              ),
            }))
            return fail('復原標的', err)
          }
        },

        updateAsset: async (categoryId: string, assetId: string, updates: Partial<Asset>) => {
          const before = get().categories.find((c) => c.id === categoryId)
          set((state) => ({
            categories: state.categories.map((c) =>
              c.id === categoryId
                ? { ...c, assets: c.assets.map((a) => (a.id === assetId ? { ...a, ...updates } : a)) }
                : c
            ),
          }))
          try {
            await apiWrite('/api/assets', 'PUT', { id: assetId, ...updates })
            return true
          } catch (err) {
            if (before) replaceCategory(before)
            return fail('更新標的', err)
          }
        },
      }
    },
    {
      // 新的 key：只存 UI 偏好。舊的 'portfolio-storage'（含分類資料）保留不動，
      // 供「系統設定 → 手動從 LocalStorage 匯入」使用。
      name: 'portfolio-ui-prefs',
      partialize: (state) => ({ displayCurrency: state.displayCurrency }),
    }
  )
)
