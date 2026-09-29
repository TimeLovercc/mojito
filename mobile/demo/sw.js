// Demo service worker: runs mock/server.mjs in the browser and answers every request under the demo hub path.
// build-demo.mjs replaces the three placeholders. The mock starts fresh on every page load (navigation),
// keeping only the interface language so the in-app language switch survives its own reload.
const HUB = '__MOJITO_DEMO_HUB__'
const TIMEZONE = '__MOJITO_DEMO_TIMEZONE__'
const TOKEN = 'demo'

function runMock() {
  __MOJITO_DEMO_MOCK__
}

let current = null
let ready = null

function start(language) {
  if (current !== null) current.timers.forEach(clearInterval)
  globalThis.__mojitoDemo = { handler: null, timers: [], token: TOKEN, language, timezone: TIMEZONE }
  runMock()
  current = globalThis.__mojitoDemo
  if (current.handler === null) throw new Error('mock did not call createServer().listen()')
}

function call(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    let status = null
    let resHeaders = null
    const req = {
      method,
      url: path,
      headers: { host: 'demo', authorization: `Bearer ${TOKEN}`, ...headers },
      async *[Symbol.asyncIterator]() {
        if (body.byteLength > 0) yield new Uint8Array(body)
      },
    }
    const res = {
      writeHead(s, h) {
        status = s
        resHeaders = h
      },
      end(data) {
        const empty = status === 204 || status === 304
        resolve(new Response(empty ? null : data, { status, headers: resHeaders }))
      },
    }
    current.handler(req, res).catch(reject)
  })
}

async function languageOf() {
  const res = await call('GET', '/settings', {}, new ArrayBuffer(0))
  return (await res.json()).language
}

async function restart() {
  start(current === null ? 'en' : await languageOf())
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.mode === 'navigate') {
    ready = restart()
    return
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(HUB + '/')) return
  if (ready === null) ready = restart()
  event.respondWith(
    (async () => {
      await ready
      const headers = {}
      for (const name of ['content-type', 'user-agent']) {
        const value = event.request.headers.get(name)
        if (value !== null) headers[name] = value
      }
      const body = await event.request.arrayBuffer()
      return call(event.request.method, url.pathname.slice(HUB.length) + url.search, headers, body)
    })(),
  )
})
