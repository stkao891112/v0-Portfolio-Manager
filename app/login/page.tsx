'use client'

import React, { useState } from 'react'
import { Lock, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { safeNextPath } from '@/lib/auth'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || '登入失敗，請稍後再試')
        setSubmitting(false)
        return
      }

      const next = new URLSearchParams(window.location.search).get('next')
      window.location.href = safeNextPath(next)
    } catch {
      setError('無法連線，請確認網路後再試')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm border-border/40 bg-card/60 backdrop-blur-xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Terminal className="size-6 text-primary" />
          </div>
          <CardTitle className="text-lg">投資決策與資產管理系統</CardTitle>
          <CardDescription>請輸入密碼登入（登入後 30 天內不用再輸入）</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={!password || submitting}>
              <Lock className="size-4" />
              {submitting ? '登入中…' : '登入'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
