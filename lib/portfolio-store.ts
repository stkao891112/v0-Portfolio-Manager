'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { Category, Asset, Currency, getNextColor } from './portfolio-types'

interface PortfolioStore {
  categories: Category[]
  displayCurrency: Currency
  exchangeRate: number // 1 USD = X TWD
  isDbConnected: boolean
  syncWithDatabase: () => Promise<void>
  setDisplayCurrency: (currency: Currency) => void
  setExchangeRate: (rate: number) => void
  addCategory: (name: string) => void
  removeCategory: (id: string) => void
  updateCategory: (id: string, name: string) => void
  addAsset: (
    categoryId: string,
    symbol: string,
    targetPercent: number,
    currency: Currency,
    quantity?: number,
    costPerUnit?: number
  ) => void
  removeAsset: (categoryId: string, assetId: string) => void
  restoreAsset: (categoryId: string, asset: Asset, index?: number) => void
  updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => void
  convertToDisplayCurrency: (value: number, fromCurrency: Currency) => number
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      categories: [],
      displayCurrency: 'TWD',
      exchangeRate: 32.5,
      isDbConnected: false,

      syncWithDatabase: async () => {
        try {
          const res = await fetch('/api/portfolio')
          if (res.ok) {
            const data = await res.json()
            if (data.categories && data.categories.length > 0) {
              set({
                categories: data.categories,
                displayCurrency: data.settings?.displayCurrency || get().displayCurrency,
                exchangeRate: data.settings?.exchangeRate || get().exchangeRate,
                isDbConnected: true,
              })
            } else {
              // If SQLite is empty, check if we have local categories to migrate!
              const localCats = get().categories
              if (localCats && localCats.length > 0) {
                await fetch('/api/migrate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    categories: localCats,
                    displayCurrency: get().displayCurrency,
                    exchangeRate: get().exchangeRate,
                  }),
                })
              }
              set({ isDbConnected: true })
            }
          }
        } catch (err) {
          console.warn('Database offline, using localStorage fallback', err)
        }
      },

      setDisplayCurrency: (currency: Currency) => {
        set({ displayCurrency: currency })
        fetch('/api/portfolio', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayCurrency: currency, exchangeRate: get().exchangeRate }),
        }).catch(() => {})
      },

      setExchangeRate: (rate: number) => {
        set({ exchangeRate: rate })
        fetch('/api/portfolio', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayCurrency: get().displayCurrency, exchangeRate: rate }),
        }).catch(() => {})
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

      addCategory: (name: string) => {
        const usedColors = get().categories.map((c) => c.color)
        const newColor = getNextColor(usedColors)
        const id = uuidv4()

        set((state) => ({
          categories: [
            ...state.categories,
            {
              id,
              name,
              color: newColor,
              assets: [],
            },
          ],
        }))

        fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color: newColor }),
        }).catch(() => {})
      },

      removeCategory: (id: string) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
        }))

        fetch(`/api/categories?id=${id}`, {
          method: 'DELETE',
        }).catch(() => {})
      },

      updateCategory: (id: string, name: string) => {
        set((state) => ({
          categories: state.categories.map((c) => (c.id === id ? { ...c, name } : c)),
        }))

        fetch('/api/categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name }),
        }).catch(() => {})
      },

      addAsset: (
        categoryId: string,
        symbol: string,
        targetPercent: number,
        currency: Currency,
        quantity = 0,
        costPerUnit = 0
      ) => {
        const assetId = uuidv4()
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId
              ? {
                  ...c,
                  assets: [
                    ...c.assets,
                    {
                      id: assetId,
                      symbol: symbol.toUpperCase(),
                      targetPercent,
                      quantity,
                      costPerUnit,
                      currency,
                    },
                  ],
                }
              : c
          ),
        }))

        fetch('/api/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId,
            symbol: symbol.toUpperCase(),
            targetPercent,
            currency,
            quantity,
            costPerUnit,
          }),
        }).catch(() => {})
      },

      removeAsset: (categoryId: string, assetId: string) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId ? { ...c, assets: c.assets.filter((a) => a.id !== assetId) } : c
          ),
        }))

        fetch(`/api/assets?id=${assetId}`, {
          method: 'DELETE',
        }).catch(() => {})
      },

      restoreAsset: (categoryId: string, asset: Asset, index?: number) => {
        set((state) => ({
          categories: state.categories.map((c) => {
            if (c.id !== categoryId) return c
            const assets = [...c.assets]
            if (typeof index === 'number' && index >= 0 && index <= assets.length) {
              assets.splice(index, 0, asset)
            } else {
              assets.push(asset)
            }
            return { ...c, assets }
          }),
        }))
      },

      updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId
              ? {
                  ...c,
                  assets: c.assets.map((a) => (a.id === assetId ? { ...a, ...updates } : a)),
                }
              : c
          ),
        }))

        fetch('/api/assets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: assetId, ...updates }),
        }).catch(() => {})
      },
    }),
    {
      name: 'portfolio-storage',
    }
  )
)
