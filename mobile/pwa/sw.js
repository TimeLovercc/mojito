// mojito 网页版的 Service Worker（docs/api.md "iPhone 网页版（PWA）与 Web Push" 的 sw.js 约定）。
// 纯 JS，不经过打包；BUILD 和 PRECACHE 由 scripts/build-pwa.mjs 在构建时填入。
// 只做离线兜底，不做离线优先；不碰 API 请求。
const BUILD = '__MOJITO_BUILD__'
const PRECACHE = __MOJITO_PRECACHE__
const CACHE = `mojito-${BUILD}`
const SCOPE = '/app/'
const NETWORK_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SCOPE, `${SCOPE}pwa-boot.js`, ...PRECACHE]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mojito-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// 导航请求和 pwa-boot.js：先走网络；出错、4 秒没回、非 2xx 时读缓存。
// 所有导航都是同一个 index.html（客户端路由），缓存里统一存在 /app/ 下
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE)
  const network = fetch(request).then(async (res) => {
    const type = res.headers.get('content-type')
    if (res.ok && type !== null && (type.startsWith('text/html') || type.startsWith('text/javascript'))) {
      await cache.put(cacheKey, res.clone())
    }
    return res
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS))
  const first = await Promise.race([network.catch(() => 'error'), timeout])
  if (first !== 'error' && first !== 'timeout' && first.ok) return first
  const cached = await cache.match(cacheKey)
  if (cached !== undefined) return cached
  // 缓存里也没有：超时就接着等网络，其余把网络的结果原样交回
  if (first === 'timeout') return network
  if (first === 'error') return network
  return first
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached !== undefined) return cached
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  // 只接管同源、GET、/app/ 下的请求；API 和其他一律放过（不调用 respondWith）
  if (url.origin !== self.location.origin || request.method !== 'GET' || !url.pathname.startsWith(SCOPE)) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SCOPE))
    return
  }
  if (url.pathname === `${SCOPE}pwa-boot.js`) {
    event.respondWith(networkFirst(request, `${SCOPE}pwa-boot.js`))
    return
  }
  if (url.pathname.startsWith(`${SCOPE}_expo/static/`) || url.pathname.startsWith(`${SCOPE}assets/`)) {
    event.respondWith(cacheFirst(request))
  }
  // 其他（version.json、manifest、icons、sw.js）不拦
})

async function tellWindows(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const w of windows) w.postMessage(message)
}

// 载荷是 Declarative Web Push 格式（docs/api.md "推送载荷"）。
// 有 event.notification：浏览器已按声明式显示过（iOS 18.4+），这里不再显示一遍
self.addEventListener('push', (event) => {
  const payload = event.data.json()
  const n = payload.notification
  const shown =
    'notification' in event && event.notification !== null && event.notification !== undefined
      ? Promise.resolve()
      : self.registration.showNotification(n.title, {
          body: n.body,
          silent: n.silent,
          tag: n.data.record_id,
          data: { ...n.data, navigate: n.navigate },
        })
  event.waitUntil(shown.then(() => tellWindows({ type: 'push', record_id: n.data.record_id })))
})

// navigate 只认同源、/app/ 下的地址，其余一律改成 /app/
function safeUrl(navigate) {
  if (typeof navigate !== 'string') return SCOPE
  let url
  try {
    url = new URL(navigate)
  } catch {
    return SCOPE
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return SCOPE
  return url.pathname + url.search
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const url = safeUrl(data === null || data === undefined ? undefined : data.navigate)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      if (windows.length === 0) return self.clients.openWindow(url)
      const w = windows[0]
      w.postMessage({ type: 'open', url })
      return w.focus()
    }),
  )
})
