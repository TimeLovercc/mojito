# mojito desktop（Mac app）

Tauri 2 外壳，加载 mobile 的网页构建（`../mobile/dist`，`expo export -p web` 产物）。功能同手机。设计见 `../docs/design.md` 8.4。
不签名（不买 Apple 开发者账号）：首次打开在"应用程序"里右键 →"打开"。

进度：第 1 步"能用"、第 3 步"融入系统"（菜单栏、通知、Dock 角标、开机自启）、第 4 步"装进应用程序 + 自动更新"在这里；第 2 步宽屏布局在 mobile。

## 一次性准备

- Rust：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal`，之后 `export PATH=$HOME/.cargo/bin:$PATH`
- Xcode 命令行工具
- `cd desktop && npm install`；`cd mobile && npm install`
- `cp desktop/.env.example desktop/.env` 并填好（`MOJITO_TIMEZONE` 在编译时写进菜单栏的时间显示，和 mobile、hub 的时区一致；发布还要 `MOJITO_SECRETS_DIR`、`MOJITO_CODESIGN_DIR`、`MOJITO_CODESIGN_IDENTITY`）

## 运行

```bash
cd desktop
npm run web      # = cd ../mobile && npx expo export -p web，产物 ../mobile/dist
npm run dev      # debug 构建并打开窗口（网页包在编译时嵌入，改了 mobile 要先重新 npm run web）
npm run build    # release：src-tauri/target/release/bundle/macos/Mojito.app
npm run build:dev  # debug 包：src-tauri/target/debug/bundle/macos/Mojito.app（有正式图标和名字、存储走 dev 文件；给用户临时看用它，不要给裸二进制）
npm run release -- --message "<一句话>" --notes "改了什么1;改了什么2"   # 发布，见下
```

**给用户的包一律连真 hub**（你自己的 https 地址），首次启动在系统页填地址和 app 令牌（release 包存钥匙串）。
假服务器（`cd mobile && MOCK_TOKEN=dev PORT=8788 npm run mock`，时区读 `mobile/.env`）只用于开发者自测，不要把连假服务器的窗口留给用户。

## 给 mobile 的接口（网页端令牌存储）

`tauri.conf.json` 开了 `withGlobalTauri`，页面里有 `window.__TAURI__.core.invoke`，不用装 `@tauri-apps/api`。
三个命令，参数名和返回值对齐 expo-secure-store：

| 命令 | 参数 | 返回 |
|---|---|---|
| `secret_get` | `{ key: string }` | `string \| null`（没有这一项为 `null`） |
| `secret_set` | `{ key: string, value: string }` | `null` |
| `secret_remove` | `{ key: string }` | `null`（不存在也不报错） |

出错时 invoke 的 Promise reject，值是中文错误字符串。

mobile 的 `src/config/secure.web.ts` 在 Tauri 里（`'__TAURI__' in window`）改调这三个命令，例如：

```ts
const { invoke } = (window as any).__TAURI__.core
export const secure = {
  get: (key: string) => invoke('secret_get', { key }) as Promise<string | null>,
  set: (key: string, value: string) => invoke('secret_set', { key, value }) as Promise<void>,
  remove: (key: string) => invoke('secret_remove', { key }) as Promise<void>,
}
```

普通浏览器开发模式（没有 `__TAURI__`）怎么存由 mobile 定。

存放处：
- **release 包**：macOS 钥匙串，service `com.example.mojito`，account = key（如 `mojito.token`）。
- **debug 构建**：`~/Library/Application Support/mojito-dev/secrets.json`（权限 600）。未签名的开发二进制每次重编译签名都变，读钥匙串会反复弹授权框，所以开发期不碰钥匙串。

## 给 mobile 的接口（第 3 步）

全部只在 `'__TAURI__' in window` 时有效。

- **菜单栏面板**：路由 `/menubar`，窗口 380×560、无边框、失焦自动收起。面板里的"打开 Mojito"/"打开"/系统状态调 `invoke('open_main', { path })`（如 `'/'`、`'/items/<id>'`、`'/system'`）：收起面板、主窗口到前台，并向主窗口发 `navigate`。
- **事件**（`window.__TAURI__.event.listen`）：
  - `navigate`（只发主窗口），payload 是路径字符串 → `router.push`。通知点击也走它。
  - `pulse`（所有窗口），每次成功取 `/pulse` 后发，payload `{due_today, needs_you, new_records}`；`new_records > 0` 时静默刷新当前页。
  - `panel-shown`（只发面板），每次弹出前发 → 刷新。
  - `auth-failed`（所有窗口），`/pulse` 返回 401/403 时发，payload 为状态码 → 提示重新输入令牌。
- **开机自启开关**（系统页）：`window.__TAURI__.autostart.isEnabled()` / `enable()` / `disable()`。首次从"应用程序"启动时自动打开一次，之后以开关为准（从 debug 构建或 `target/` 里的包启动不注册，以免登录项指向临时路径）。
- **窗口外观**（docs/desktop-v2.md #13）：主窗口标题栏透明、不显示标题；红黄绿 `traffic_light_position(18, 28)`，和页面 52 高的顶栏同一行、垂直居中（实测 y=27 时圆心在 24.5pt）。窗口背后是 macOS 侧边栏毛玻璃（`transparent` + `Effect::Sidebar`），页面侧边栏和根背景透明才透得出来。**shell 不再注入拖动条**：拖动区由页面自己标（顶栏 `dataSet={{ tauriDragRegion: 'deep' }}`，侧栏顶部 0–52 同样），带 tabindex 的按钮自动排除；双击拖动区 = 缩放（Tauri drag.js，macOS 在 mouseup 触发，权限在 `core:window:default` 里）。验证：AppKit hitTest 显示窗口顶部 0–40pt 整条的点击都落在 WKWebView 上，tao 的标题栏容器不挡。
- **深浅色**（#14）：`invoke('set_theme', { scheme })`，scheme 同 `mobile/src/theme.ts` 的 `'system' | 'dark' | 'light'`；主窗口和菜单栏面板一起改（毛玻璃、红黄绿、滚动条跟着变），选择记在 `~/Library/Application Support/com.example.mojito/color-scheme`，下次启动建窗口时就带上（首屏之前）。页面在启动时和改配色时各调一次。
- Rust 轮询用的 hub 地址和令牌就是 mobile 存的 `mojito.hubUrl` / `mojito.token`，key 名不要改。

## 菜单栏、角标、通知（Rust，`src/pulse.rs`、`src/tray.rs`、`src/notify.rs`）

- 运行期间每 30 秒 `GET /pulse?limit=50&after=<游标>`，`more=true` 时连续取完；游标存 `~/Library/Application Support/com.example.mojito/pulse-cursor`，每页取完就存。
- 菜单栏：圆形 logo 图标（`icons/tray.png`，由 `mobile/scripts/make-icons.py` 生成）+ 下一件事 = `/today.focus` 第一条"标题 · 时间"（今天的事按 `MOJITO_TIMEZONE` 显示 HH:MM，以后的显示"还有 N 天"，标题超 14 字截断；没有则只留图标）；每轮取完 `/pulse` 后取一次 `/today`。Dock 角标 = 待你数（0 不显示）；没设置 hub 显示"mojito · 还没设置 hub"，401/403 显示"mojito · 令牌无效"；网络错误 / 5xx 下次照常重试。
- 关主窗口只是隐藏，app 留在菜单栏；点 Dock 图标重新显示。

## 换 hub 清缓存

页面里在系统页换 hub 时会自己清缓存；在页面之外改了地址或令牌（直接改钥匙串或 dev 存储文件）则由 shell 兜底：启动时比对上次的 hub 指纹（地址 + 令牌的 sha256，存 `~/Library/Application Support/com.example.mojito/hub-fingerprint`，debug 构建为 `hub-fingerprint-debug`），变了就清空 WebView 网页数据并重载（`src/webcache.rs`）。

## 发布与自动更新（第 4 步）

- **装在 `~/Applications/Mojito.app`**（当前用户的"应用程序"，不需要管理员权限）。
- `npm run release -- --message … --notes …`（`scripts/release.mjs`）：
  1. 版本号 `0.1.<UTC YYMMDDHHmm>`（`tauri build --config` 覆盖，不改文件），每次发布递增；
  2. `npm run web` + release 打包；
  3. 新包先 `ditto` 到 `~/Applications/.mojito-incoming.app`，旧包挪到 `.mojito-outgoing.app`，换名后删旧包；app 没在运行就打开它；
  4. `POST /events`（`category=release`、`tier=digest`，令牌 `$MOJITO_SECRETS_DIR/cards.env`）推"Mac 版已更新：…"，手机和 Mac 都收到。
- 正在运行的旧版每 30 秒比对磁盘上 `~/Applications/Mojito.app/Contents/Info.plist` 的版本号（`src/update.rs`），变了就弹一次"Mojito 新版已装好，点这里重启生效"，并向页面发 `update-ready`（payload 新版本号）；页面可调 `invoke('relaunch')` 重启。点通知 / relaunch = `open -n ~/Applications/Mojito.app` 后退出旧版。
- 开机自启：首次从 `~/Applications` 启动时注册 `~/Library/LaunchAgents/mojito.plist`。
- 不走 Tauri updater：构建机就是你自己的 Mac，没有要托管的更新包。
- **签名**：release 用本机自签名证书重签（`codesign --sign "$MOJITO_CODESIGN_IDENTITY"`），签名身份固定为"bundle id + 这张证书"，对钥匙串点一次"始终允许"后，以后更新不再问。（ad-hoc 签名每次更新都变，每次都会再问并要登录密码。）
  - 证书：自己用 openssl 生成一张只有 Code Signing 用途、CA:FALSE 的自签名证书（`codesign.crt` / `codesign.key`，CN 就是 `MOJITO_CODESIGN_IDENTITY`），导入一个单独的钥匙串 `$MOJITO_CODESIGN_DIR/mojito-codesign.keychain-db`（口令放 `$MOJITO_CODESIGN_DIR/codesign.pass`，只允许 codesign 使用），不动登录钥匙串。都在仓库外，永不入库，要离线备份——丢了换新证书，要再点一次"始终允许"。
  - 信任一次：`security add-trusted-cert -r trustRoot -p codeSign -k "$MOJITO_CODESIGN_DIR/mojito-codesign.keychain-db" "$MOJITO_CODESIGN_DIR/codesign.crt"`（弹一次系统窗口）。没信任时 codesign 报"no identity found"。codesign 只在用户钥匙串搜索列表里找身份（`--keychain` 不管用），`release.mjs` 签名期间把这个钥匙串临时加进搜索列表，签完恢复。
  - `tauri.conf.json` 里的 `signingIdentity: "-"` 只管 `npm run build` / `build:dev`（ad-hoc）；发布一律走 `npm run release`。

## Mac 通知

`/pulse` 取到的记录（interrupt / digest / quiet，和手机推送同一范围）按 `GET /settings` 的 `notify[category]` 过滤后弹 macOS 通知（design 8.6）；quiet 静默，其余有声音；主窗口在前台时不弹；一轮超过 3 条合并成"有 N 条新消息"。点击：对话记录 → `/chat`，有事项 → `/items/<id>`，其余 → `/`。

## 日志

`~/Library/Logs/com.example.mojito/webview.log`：网页报错（error、unhandledrejection、console.error、经 Rust 的请求失败）、/pulse 失败（带底层原因）、新版提示和网页内容进程被系统回收（此时自动重载）的记录，每行开头是 Unix 时间戳。白屏先看这里。

## 网络

页面来源是 `tauri://localhost`，hub 不返回 CORS 头，WebView 自己的 fetch 会被拦。
`src-tauri/src/shell.js` 在页面加载前把 `window.fetch` 换掉：`http(s)://` 请求改走 Tauri HTTP 插件（由 Rust 发出），`blob:` / `data:` 仍走 WebView。mobile 不用改。
允许的地址在 `src-tauri/capabilities/default.json`：`https://*.ts.net/*`、`http://localhost:*`、`http://127.0.0.1:*`。hub 不在 Tailscale 域名下时，把你的 hub 域名加进去再构建。

## 已知坑

- WKWebView 默认 UA 不带 "Safari"，expo-font 会走 fontfaceobserver，在 WKWebView 里 12 秒超时、整页白屏。窗口 UA 设成 Safari 的（`lib.rs` 里 `USER_AGENT`），expo-font 就像在真 Safari 里一样跳过它。
- 未签名：每次换新版 app，第一次读钥匙串 macOS 会问一次，点"始终允许"。
