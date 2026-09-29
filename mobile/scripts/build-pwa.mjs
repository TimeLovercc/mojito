// 网页版（PWA）构建：MOJITO_WEB_BUILD=<git sha 前 12 位> npm run build:pwa
// 产物在 dist-pwa/，由 hub 在 /app/ 下提供（docs/api.md "iPhone 网页版（PWA）与 Web Push"，内部 PWA 计划（未公开） M1）。
// 1) expo export -p web，只在子进程里设 MOJITO_WEB_BASE_URL=/app（app.config.js 据此加 baseUrl、去掉 EAS 信息）
// 2) 拷 pwa/（manifest、sw.js、图标），生成 pwa-boot.js 和 version.json，往 sw.js 填 BUILD 和预缓存清单
// 3) 按锚点改 index.html（每个锚点必须恰好命中一次），最后检查产物
// Mac 版（desktop 的 npm run web → mobile/dist）不经过这里。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const BASE = '/app'
const OUT = 'dist-pwa'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, OUT)

const build = process.env.MOJITO_WEB_BUILD
if (build === undefined) throw new Error('缺 MOJITO_WEB_BUILD（git sha 前 12 位，deploy-web.sh 会设）')
if (!/^[0-9a-f]{12}$/.test(build)) throw new Error(`MOJITO_WEB_BUILD 要是 12 位十六进制：${build}`)

execFileSync('npx', ['expo', 'export', '-p', 'web', '--output-dir', OUT, '--clear'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MOJITO_WEB_BASE_URL: BASE },
})

cpSync(join(root, 'pwa'), out, { recursive: true })

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const urlOf = (file) => `${BASE}/${relative(out, file).split('\\').join('/')}`

// pwa-boot.js：先于主包同步执行。标记网页版，并按深浅色设置（没有就按系统）写 theme-color 和页面底色，冷启动不闪白。
// 底色取 src/theme.ts 的 DARK.bg / LIGHT.bg；"跟随系统"和 theme.ts 一样：系统不是浅色就当深色
const theme = readFileSync(join(root, 'src', 'theme.ts'), 'utf8')
function bgOf(name) {
  const m = [...theme.matchAll(new RegExp(`const ${name}(?:: typeof DARK)? = \\{\\s*bg: '(#[0-9a-f]{6})'`, 'g'))]
  if (m.length !== 1) throw new Error(`src/theme.ts 里找不到唯一的 ${name}.bg（命中 ${m.length} 次）`)
  return m[0][1]
}
const boot = `// 构建时生成（scripts/build-pwa.mjs），不要手改
window.__MOJITO_PWA__ = { build: ${JSON.stringify(build)} };
(function () {
  var stored = window.localStorage.getItem('mojito.colorScheme');
  var dark = stored === null || stored === 'system' ? !window.matchMedia('(prefers-color-scheme: light)').matches : stored === 'dark';
  var bg = dark ? ${JSON.stringify(bgOf('DARK'))} : ${JSON.stringify(bgOf('LIGHT'))};
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
  document.documentElement.style.backgroundColor = bg;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
`
writeFileSync(join(out, 'pwa-boot.js'), boot)
writeFileSync(join(out, 'version.json'), JSON.stringify({ build, built_at: new Date().toISOString() }))

function replaceOnce(text, anchor, replacement, file) {
  const hits = text.split(anchor).length - 1
  if (hits !== 1) throw new Error(`${file} 里锚点 ${JSON.stringify(anchor)} 命中 ${hits} 次，要恰好 1 次`)
  return text.replace(anchor, () => replacement)
}

// sw.js：填版本号和本版本的静态文件清单（_expo/static/**、assets/**）
const precache = walk(out)
  .map(urlOf)
  .filter((u) => u.startsWith(`${BASE}/_expo/static/`) || u.startsWith(`${BASE}/assets/`))
  .sort()
const swPath = join(out, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
sw = replaceOnce(sw, "'__MOJITO_BUILD__'", JSON.stringify(build), 'sw.js')
sw = replaceOnce(sw, '__MOJITO_PRECACHE__', JSON.stringify(precache), 'sw.js')
writeFileSync(swPath, sw)

const htmlPath = join(out, 'index.html')
let html = readFileSync(htmlPath, 'utf8')
html = replaceOnce(html, '<html lang="en">', '<html lang="zh-CN">', 'index.html')
html = replaceOnce(
  html,
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />',
  'index.html',
)
html = replaceOnce(
  html,
  '<title>Mojito</title>',
  [
    '<title>Mojito</title>',
    `<link rel="manifest" href="${BASE}/manifest.webmanifest" />`,
    `<link rel="apple-touch-icon" href="${BASE}/icons/icon-180.png" />`,
    '<meta name="apple-mobile-web-app-title" content="Mojito" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    `<meta name="theme-color" content="${bgOf('DARK')}" />`,
    '<style id="pwa">html,body{position:fixed;inset:0;overflow:hidden;touch-action:manipulation}</style>',
    `<script src="${BASE}/pwa-boot.js"></script>`,
  ].join('\n    '),
  'index.html',
)
writeFileSync(htmlPath, html)

// 检查产物（deploy-web.sh 还会再查一遍）
const problems = []
for (const m of html.matchAll(/\s(src|href)="([^"]*)"/g)) {
  if (!m[2].startsWith(`${BASE}/`)) problems.push(`index.html 的 ${m[1]} 不在 ${BASE}/ 下：${m[2]}`)
}
for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
  if (!/\ssrc="/.test(m[1])) problems.push(`index.html 有内联 <script>：${m[0]}`)
}
const ALLOWED = new Set(['html', 'js', 'css', 'json', 'webmanifest', 'png', 'ico', 'ttf', 'woff2'])
// 部署者自己的 EAS 项目 id 只在 mobile/.env 里（MOJITO_OTA=eas 时，不入库）。本地构建时有这个文件就查 id 没进网页产物；
// deploy-web.sh 从干净的已提交树构建，没有 .env，也就没有 id 可漏。
const envFile = join(root, '.env')
const projectId = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).MOJITO_EAS_PROJECT_ID : undefined
// expo-router 自带代码里有字面量 'u.expo.dev'（解析 exp 链接用），查的是更新地址 https://u.expo.dev/
const FORBIDDEN = ['sourceMappingURL', 'EXPO_PUBLIC_', 'https://u.expo.dev', ...(projectId === undefined ? [] : [projectId])]
for (const file of walk(out)) {
  const name = relative(out, file)
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (!ALLOWED.has(ext)) problems.push(`扩展名不在白名单：${name}`)
  if (!['js', 'html', 'json', 'css', 'webmanifest'].includes(ext)) continue
  const text = readFileSync(file, 'utf8')
  for (const s of FORBIDDEN) if (text.includes(s)) problems.push(`${name} 含 ${s}`)
}
if (problems.length > 0) throw new Error(`dist-pwa 检查没过：\n${problems.join('\n')}`)
console.log(`dist-pwa 就绪：build ${build}，预缓存 ${precache.length} 个文件`)
