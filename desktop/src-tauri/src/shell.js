// 桌面外壳注入每个窗口的脚本（页面脚本之前运行）。
;(() => {
  const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args)

  // 网页里的 http(s) 请求改走 Rust 的 hub_fetch（src/fetch.rs：所有窗口共用一条 HTTP/2 连接，为什么不用 HTTP 插件也见那里）：
  // 页面来源是 tauri://localhost，hub 不带 CORS 头，浏览器 fetch 会被拦。
  // blob: / data: / 本地资源仍用 WebView 自己的 fetch。
  // 失败时换成浏览器 fetch 的 TypeError（页面按浏览器习惯读 err.message），并记进日志。
  // 中止（页面的 signal）立即 reject AbortError；Rust 那边的请求到它自己的超时为止。
  // GET 每次 9 秒超时，失败重发一次（Rust 出错后已换新连接；两次最多 18 秒，在页面自己的 20 秒之内）。
  // 写操作不重发，免得重复提交；超时放宽到 60 秒（上传照片），页面自己的 signal 照样能中止。
  const GET_MS = 9000
  const WRITE_MS = 60000
  const NULL_BODY = [101, 103, 204, 205, 304]
  const webFetch = window.fetch.bind(window)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const pack = (head, body) => {
    const out = new Uint8Array(4 + head.length + body.length)
    new DataView(out.buffer).setUint32(0, head.length)
    out.set(head, 4)
    out.set(body, 4 + head.length)
    return out
  }
  const aborted = (signal) =>
    new Promise((_, reject) => {
      if (signal.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })
  const hubFetch = async (request, url) => {
    const write = request.method !== 'GET' && request.method !== 'HEAD'
    const body = write ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array()
    const meta = { method: request.method, url, headers: [...request.headers], timeout_ms: write ? WRITE_MS : GET_MS }
    const call = invoke('hub_fetch', pack(encoder.encode(JSON.stringify(meta)), body)).catch((reason) => {
      log(`fetch failed ${request.method} ${url} ${reason}`)
      throw new TypeError(String(reason))
    })
    // 请求先完成、之后才中止时，这个 reject 没人等：先挂个空 catch，免得记成 unhandledrejection
    const stop = aborted(request.signal)
    stop.catch(() => {})
    const packed = new Uint8Array(await Promise.race([call, stop]))
    const len = new DataView(packed.buffer).getUint32(0)
    const head = JSON.parse(decoder.decode(packed.subarray(4, 4 + len)))
    const payload = NULL_BODY.includes(head.status) ? null : packed.subarray(4 + len)
    return new Response(payload, { status: head.status, headers: head.headers })
  }
  window.fetch = (input, init) => {
    const request = new Request(input, init)
    const url = request.url
    if (!/^https?:\/\//.test(url)) return webFetch(input, init)
    const first = hubFetch(request.clone(), url)
    if (request.method !== 'GET') return first
    return first.catch((error) => {
      if (request.signal.aborted) throw error
      return hubFetch(request, url)
    })
  }

  // 网页报错写进日志文件（~/Library/Logs/com.example.mojito/webview.log），白屏时能查到原因
  const log = (msg) => invoke('log_web', { msg: `${location.pathname} ${msg}` })
  window.addEventListener('error', (e) => log(`error ${e.message} @${e.filename}:${e.lineno}:${e.colno}`))
  window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection ${e.reason instanceof Error ? e.reason.stack : String(e.reason)}`))
  const consoleError = console.error.bind(console)
  console.error = (...args) => {
    log(`console.error ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`)
    consoleError(...args)
  }
})()
