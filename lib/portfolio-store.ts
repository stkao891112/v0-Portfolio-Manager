'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { Category, Asset, Currency, getNextColor } from './portfolio-types'

interface PortfolioStore {
  categories: Category[]
  displayCurrency: Currency
  exchangeRate: number // 1 USD = X TWD
  setDisplayCurrency: (currency: Currency) => void
  setExchangeRate: (rate: number) => void
  addCategory: (name: string) => void
  removeCategory: (id: string) => void
  updateCategory: (id: string, name: string) => void
  addAsset: (categoryId: string, symbol: string, targetPercent: number, currency: Currency) => void
  removeAsset: (categoryId: string, assetId: string) => void
  updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => void
  convertToDisplayCurrency: (value: number, fromCurrency: Currency) => number
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      categories: [],
      displayCurrency: 'TWD',
      exchangeRate: 32.5,
      
      setDisplayCurrency: (currency: Currency) => {
        set({ displayCurrency: currency })
      },
      
      setExchangeRate: (rate: number) => {
        set({ exchangeRate: rate })
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
        const usedColors = get().categories.map(c => c.color)
        set((state) => ({
          categories: [
            ...state.categories,
            {
              id: uuidv4(),
              name,
              color: getNextColor(usedColors),
              assets: [],
            },
          ],
        }))
      },
      
      removeCategory: (id: string) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
        }))
      },
      
      updateCategory: (id: string, name: string) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === id ? { ...c, name } : c
          ),
        }))
      },
      
      addAsset: (categoryId: string, symbol: string, targetPercent: number, currency: Currency) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId
              ? {
                  ...c,
                  assets: [
                    ...c.assets,
                    {
                      id: uuidv4(),
                      symbol: symbol.toUpperCase(),
                      targetPercent,
                      quantity: 0,
                      costPerUnit: 0,
                      currency,
                    },
                  ],
                }
              : c
          ),
        }))
      },
      
      removeAsset: (categoryId: string, assetId: string) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId
              ? { ...c, assets: c.assets.filter((a) => a.id !== assetId) }
              : c
          ),
        }))
      },
      
      updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === categoryId
              ? {
                  ...c,
                  assets: c.assets.map((a) =>
                    a.id === assetId ? { ...a, ...updates } : a
                  ),
                }
              : c
          ),
        }))
      },
    }),
    {
      name: 'portfolio-storage',
    }
  )
)
