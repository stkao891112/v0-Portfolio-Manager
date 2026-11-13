import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, getAppPassword, isAuthRequired, verifySessionToken } from '@/lib/auth'

// 不需要登入就能打開的路徑
const PUBLIC_PATHS = ['/login', '/api/auth/login']

/**
 * 網站登入保護（Next.js 16 的 proxy，舊名 middleware）
 * - 本機 npm run dev：不檢查
 * - Vercel：沒登入的網頁導到 /login；沒登入的 API 回 401
 */
export async function proxy(request: NextRequest) {
  if (!isAuthRequired()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  const password = getAppPassword()
  if (!password) {
    const message = '網站尚未設定登入密碼：請在 Vercel 專案的環境變數設定 APP_PASSWORD 後重新部署。'
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    return new NextResponse(message, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const loggedIn = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, password)
  if (loggedIn) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '尚未登入' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  const next = pathname + search
  if (next !== '/') loginUrl.searchParams.set('next', next)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // 靜態檔案（圖示、manifest、service worker、Next.js 內部檔案）不檢查
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif)$).*)',
  ],
}
