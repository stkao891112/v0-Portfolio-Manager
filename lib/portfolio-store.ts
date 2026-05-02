'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { Category, Asset, getNextColor } from './portfolio-types'

interface PortfolioStore {
  categories: Category[]
  addCategory: (name: string) => void
  removeCategory: (id: string) => void
  updateCategory: (id: string, name: string) => void
  addAsset: (categoryId: string, symbol: string, targetPercent: number) => void
  removeAsset: (categoryId: string, assetId: string) => void
  updateAsset: (categoryId: string, assetId: string, updates: Partial<Asset>) => void
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      categories: [],
      
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
      
      addAsset: (categoryId: string, symbol: string, targetPercent: number) => {
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
