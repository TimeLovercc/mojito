// 桌面外壳注入每个窗口的脚本（页面脚本之前运行）。
;(() => {
  const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args)

  // 网页里的 http(s) 请求改走 Tauri HTTP 插件（Rust 发出）：
  // 页面来源是 tauri://localhost，hub 不带 CORS 头，浏览器 fetch 会被拦。
  // blob: / data: / 本地资源仍用 WebView 自己的 fetch。
  // 插件失败时抛的是字符串，页面按浏览器习惯读 err.message 会得到 undefined：
  // 换成浏览器 fetch 的 TypeError，并记进日志。
  // GET 连接失败重发一次：偶发的"error sending request"（多为复用了被 hub 关掉的空闲连接），
  // 浏览器自己的 fetch 遇到这种情况也会重发。写操作不重发，免得重复提交。
  const webFetch = window.fetch.bind(window)
  const tauriFetch = (input, init, url) =>
    window.__TAURI__.http.fetch(input, init).catch((reason) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      log(`fetch failed ${url} ${message}`)
      throw new TypeError(message)
    })
  window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!/^https?:\/\//.test(url)) return webFetch(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const first = tauriFetch(input, init, url)
    if (method !== 'GET') return first
    return first.catch((error) => {
      if (init?.signal?.aborted) throw error
      return tauriFetch(input, init, url)
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
