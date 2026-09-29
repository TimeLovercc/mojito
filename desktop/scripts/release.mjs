// 发布 Mac 版：npm run release -- --message "<一句话>" --notes "改了什么1;改了什么2"
// 配置在 desktop/.env（见 desktop/.env.example）：MOJITO_TIMEZONE、MOJITO_SECRETS_DIR、
// MOJITO_CODESIGN_DIR、MOJITO_CODESIGN_IDENTITY，缺了就报错。
// 1) 版本号 0.1.<UTC YYMMDDHHmm>（每次发布递增；正在运行的旧版靠它发现新版）
// 2) 用本 checkout 的 mobile 构建网页包，打 release 包，用本机自签名证书重签（签名身份固定，
//    用户"始终允许"一次钥匙串后，以后更新不再问；证书见 README"签名"）
// 3) 装进 ~/Applications/Mojito.app（先放临时名再换，不留半个包）；没在运行就打开它
// 4) 推送"Mac 版已更新"（POST /events，category=release，手机和 Mac 都会收到）
// 正在运行的旧版在 30 秒内发现磁盘上的新版，弹通知"新版已装好，点这里重启"。
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { message: { type: 'string' }, notes: { type: 'string' } } })
if (values.message === undefined) throw new Error('缺 --message "<一句话说明>"')
if (values.notes === undefined) throw new Error('缺 --notes "改了什么1;改了什么2"（给用户看的中文）')
const notes = values.notes.split(';').map((n) => n.trim()).filter((n) => n !== '')
if (notes.length === 0) throw new Error('--notes 至少一条')

const required = (name) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} 未设置（desktop/.env，见 desktop/.env.example）`)
  return value
}
required('MOJITO_TIMEZONE') // 编译进菜单栏的时间显示（src-tauri/src/pulse.rs 用 env! 读）
const SECRETS = required('MOJITO_SECRETS_DIR')
const SIGNING = required('MOJITO_CODESIGN_DIR')
const IDENTITY = required('MOJITO_CODESIGN_IDENTITY')

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const APPS = join(homedir(), 'Applications')
const APP = join(APPS, 'Mojito.app')
const BUILT = 'src-tauri/target/release/bundle/macos/Mojito.app'

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
)
const version = `0.1.${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`

// 网页版（PWA）的 /app 前缀不能漏进 Mac 版（内部 PWA 计划（未公开） desktop 一项）：
// 构建前 MOJITO_WEB_BASE_URL 必须没设（mobile/app.config.js 设了就加 baseUrl）；构建后 mobile/dist 里不能有 PWA 的东西
if (process.env.MOJITO_WEB_BASE_URL !== undefined) {
  throw new Error(`MOJITO_WEB_BASE_URL=${process.env.MOJITO_WEB_BASE_URL} 设着：Mac 版会带上网页版的 /app 前缀。先 unset 再发布`)
}
run('npm', ['run', 'web'])
const DIST = '../mobile/dist'
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
for (const marker of ['/app/_expo', '__MOJITO_PWA__', 'manifest.webmanifest']) {
  if (indexHtml.includes(marker)) throw new Error(`${DIST}/index.html 含 ${marker}：网页版（PWA）的产物漏进了 Mac 版，停止发布`)
}
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [n]))
if (walk(DIST).includes('sw.js')) throw new Error(`${DIST} 里有 sw.js：网页版（PWA）的产物漏进了 Mac 版，停止发布`)
run('npx', ['tauri', 'build', '--bundles', 'app', '--config', JSON.stringify({ version })])

const keychain = join(SIGNING, 'mojito-codesign.keychain-db')
run('security', ['unlock-keychain', '-p', readFileSync(join(SIGNING, 'codesign.pass'), 'utf8').trim(), keychain])
// codesign 只在用户钥匙串搜索列表里找签名身份（--keychain 不管用）：签名期间临时加进去，签完恢复原列表
const searchList = [...execFileSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' }).matchAll(/"([^"]+)"/g)].map((m) => m[1])
run('security', ['list-keychains', '-d', 'user', '-s', ...searchList, keychain])
try {
  run('codesign', ['--force', '--sign', IDENTITY, BUILT])
} finally {
  run('security', ['list-keychains', '-d', 'user', '-s', ...searchList])
}
run('codesign', ['--verify', '--strict', BUILT])
const requirement = execFileSync('codesign', ['-dr', '-', BUILT], { encoding: 'utf8' })
if (!requirement.includes('certificate leaf')) throw new Error(`签名不是自签名证书：${requirement}`)

// 装进"应用程序"：新包先复制到临时名，旧包挪开，再换名，最后删旧包
mkdirSync(APPS, { recursive: true })
const incoming = join(APPS, '.mojito-incoming.app')
const outgoing = join(APPS, '.mojito-outgoing.app')
for (const p of [incoming, outgoing]) rmSync(p, { recursive: true, force: true })
run('ditto', [BUILT, incoming])
const firstInstall = !existsSync(APP)
if (!firstInstall) renameSync(APP, outgoing)
renameSync(incoming, APP)
rmSync(outgoing, { recursive: true, force: true })

// pgrep：0 = 有匹配，1 = 没有，其他 = 出错
const pgrep = spawnSync('pgrep', ['-f', `${APP}/Contents/MacOS/mojito`])
if (pgrep.status !== 0 && pgrep.status !== 1) throw new Error(`pgrep 出错 ${pgrep.status}：${pgrep.stderr}`)
const running = pgrep.status === 0
if (!running) run('open', [APP])

// 推送：令牌同手机发布脚本（source:cards）
const envFile = join(SECRETS, 'cards.env')
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
for (const k of ['MOJITO_HUB_URL', 'MOJITO_CARDS_TOKEN']) if (!(k in env)) throw new Error(`${envFile} 缺 ${k}`)
const title = `Mac 版已更新：${values.message.replace(/^Mac 版已更新：/, '')}`
const restart = running ? '正在运行的 Mojito 会弹通知，点一下重启生效' : '已打开新版'
const res = await fetch(`${env.MOJITO_HUB_URL.replace(/\/+$/, '')}/events`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.MOJITO_CARDS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    kind: 'log',
    tier: 'digest',
    category: 'release',
    item_id: null,
    project_id: null,
    repo_path: null,
    title,
    body: `${notes.map((n) => `· ${n}`).join('\n')}\n${restart}，版本 ${version}`,
    evidence: null,
  }),
})
if (!res.ok) throw new Error(`推送失败 ${res.status}：${await res.text()}`)
console.log(`已装好 ${APP} ${version}，已推送：${title}`)
