import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getAppPassword,
  isAuthRequired,
  verifyPassword,
} from '@/lib/auth'

export async function POST(request: Request) {
  const password = getAppPassword()
  if (!password) {
    if (!isAuthRequired()) {
      return NextResponse.json({ success: true, message: '本機模式不需要登入' })
    }
    return NextResponse.json({ error: '網站尚未設定登入密碼（APP_PASSWORD）' }, { status: 503 })
  }

  let input = ''
  try {
    const body = await request.json()
    input = typeof body?.password === 'string' ? body.password : ''
  } catch {
    // 格式錯誤視同密碼錯誤
  }

  if (!input || !(await verifyPassword(input, password))) {
    // 放慢連續猜密碼的速度
    await new Promise((resolve) => setTimeout(resolve, 800))
    return NextResponse.json({ error: '密碼錯誤' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return response
}
