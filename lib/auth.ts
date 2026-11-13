/**
 * 簡單密碼登入
 *
 * - 部署在 Vercel（正式環境）一定要登入；本機 `npm run dev`（start.bat）不需要。
 * - 密碼設在環境變數 APP_PASSWORD；Vercel 上沒設密碼時整個網站會被擋住，不會變成公開。
 * - 登入後的憑證存在 cookie（30 天），用密碼簽章：改密碼後，所有裝置的舊登入都會失效。
 * - 只用 Web Crypto，proxy.ts 與 API 路由都能共用。
 */

export const SESSION_COOKIE = 'pm_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** 正式環境（Vercel、next start）才需要登入；next dev 不需要 */
export function isAuthRequired(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function getAppPassword(): string | undefined {
  const password = process.env.APP_PASSWORD
  return password && password.length > 0 ? password : undefined
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return base64url(new Uint8Array(signature))
}

/** 固定時間比較，避免從回應時間猜出內容 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function signingSecret(password: string): string {
  // AUTH_SECRET 可選填：額外加一組亂數，讓憑證更難偽造
  return `${process.env.AUTH_SECRET ?? ''}:${password}`
}

export async function createSessionToken(password: string): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  const signature = await hmac(signingSecret(password), `session:${expires}`)
  return `${expires}.${signature}`
}

export async function verifySessionToken(token: string | undefined, password: string): Promise<boolean> {
  if (!token) return false
  const [expiresText, signature] = token.split('.')
  const expires = Number(expiresText)
  if (!expiresText || !signature || !Number.isFinite(expires) || expires < Date.now()) return false
  const expected = await hmac(signingSecret(password), `session:${expires}`)
  return timingSafeEqual(signature, expected)
}

export async function verifyPassword(input: string, password: string): Promise<boolean> {
  // 兩邊先做 HMAC 再比較，避免長度不同或逐字比對造成的時間差
  const [a, b] = await Promise.all([hmac('password-check', input), hmac('password-check', password)])
  return timingSafeEqual(a, b)
}

/** 只允許站內路徑，避免登入後被導到外部網站 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
