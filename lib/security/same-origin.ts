/**
 * 寫入 API（POST / PUT / PATCH / DELETE）的同源檢查，防止跨站請求偽造（CSRF）。
 *
 * 本機 next dev 沒有登入保護，任何網頁都能對 http://localhost:3000/api/... 發 POST；
 * 瀏覽器發出的跨站寫入請求一定會帶 Origin（或 Sec-Fetch-Site / Referer），這裡比對它們是否同源。
 * 完全沒帶這些標頭的請求（curl、伺服器端腳本）不是 CSRF 的攻擊途徑，予以放行。
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface OriginCheckInput {
  method: string
  url: string
  headers: { get(name: string): string | null }
}

export interface OriginCheckResult {
  ok: boolean
  reason?: string
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

/** 這個請求「自己」的主機名稱（考慮反向代理 / Vercel 的 x-forwarded-host） */
function allowedHosts(input: OriginCheckInput): Set<string> {
  const hosts = new Set<string>()
  const add = (h: string | null | undefined) => {
    if (!h) return
    for (const part of h.split(',')) {
      const v = part.trim().toLowerCase()
      if (v) hosts.add(v)
    }
  }
  add(hostOf(input.url))
  add(input.headers.get('host'))
  add(input.headers.get('x-forwarded-host'))
  return hosts
}

export function checkSameOrigin(input: OriginCheckInput): OriginCheckResult {
  if (!WRITE_METHODS.has(input.method.toUpperCase())) return { ok: true }

  const fetchSite = input.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { ok: false, reason: `跨站寫入請求已阻擋（Sec-Fetch-Site: ${fetchSite}）` }
  }

  const hosts = allowedHosts(input)
  const origin = input.headers.get('origin')
  if (origin) {
    if (origin === 'null') return { ok: false, reason: '來源不明（Origin: null）的寫入請求已阻擋' }
    const h = hostOf(origin)
    return h && hosts.has(h) ? { ok: true } : { ok: false, reason: `跨站寫入請求已阻擋（Origin: ${origin}）` }
  }

  const referer = input.headers.get('referer')
  if (referer) {
    const h = hostOf(referer)
    return h && hosts.has(h) ? { ok: true } : { ok: false, reason: '跨站寫入請求已阻擋（Referer 不同源）' }
  }

  // 沒有任何來源標頭：非瀏覽器用戶端，放行
  return { ok: true }
}
