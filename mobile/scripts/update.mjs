// 空中更新：npm run update -- --message "<一句话>" --notes "改了什么1;改了什么2"
// 1) 指纹必须等于上次打 APK 记下的 $MOJITO_APK_DIR/mojito-release.runtime，否则拒绝（原生变了只能打新 APK）
// 2) eas update 发到 production（mobile/.env 里 MOJITO_OTA=eas）
// 3) 推送一条"app 已更新"通知
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

// MOJITO_WEB_BASE_URL 只给网页版（PWA）构建用：设着的话 app.config.js 会加 /app 前缀、去掉 updates 地址，空中更新就发坏了
if (process.env.MOJITO_WEB_BASE_URL !== undefined) {
  throw new Error(`MOJITO_WEB_BASE_URL=${process.env.MOJITO_WEB_BASE_URL} 设着：这是网页版构建专用的，会让空中更新带上 /app 前缀、丢掉更新地址。先 unset 再 npm run update`)
}

const { values } = parseArgs({ options: { message: { type: 'string' }, notes: { type: 'string' } } })
if (values.message === undefined) throw new Error('缺 --message "<一句话说明>"')
if (values.notes === undefined) throw new Error('缺 --notes "改了什么1;改了什么2"（给用户看的中文）')
const notes = values.notes.split(';').map((n) => n.trim()).filter((n) => n !== '')
if (notes.length === 0) throw new Error('--notes 至少一条')

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

if (process.env.MOJITO_OTA !== 'eas') throw new Error(`空中更新要求 mobile/.env 里 MOJITO_OTA=eas，现在是 ${process.env.MOJITO_OTA}`)
const apkDir = process.env.MOJITO_APK_DIR
if (apkDir === undefined || apkDir === '') throw new Error('MOJITO_APK_DIR 未设置（mobile/.env）')
const apkRuntime = readFileSync(join(apkDir, 'mojito-release.runtime'), 'utf8').trim()
const fingerprint = run('npm', ['run', '--silent', 'fingerprint']).trim().split('\n').at(-1)
if (fingerprint !== apkRuntime) {
  throw new Error(`指纹 ${fingerprint} 和上次 APK 的 ${apkRuntime} 不同：原生部分变了，不能空中更新，要打新 APK（npm run build:apk）`)
}

const out = run('npx', ['eas-cli', 'update', '--channel', 'production', '--platform', 'android', '--environment', 'production', '--message', values.message, '--non-interactive'])
process.stdout.write(out)
const match = out.match(/Android update ID\s+([0-9a-f-]+)/)
if (match === null) throw new Error('eas update 输出里找不到 Android update ID')
const updateId = match[1]

run('node', [
  'scripts/notify.mjs',
  '--title',
  // 前缀由这里加；--message 里已经写了就不再重复
  `app 已更新：${values.message.replace(/^app 已更新：/, '')}`,
  '--body',
  `${notes.map((n) => `· ${n}`).join('\n')}\n划掉 Mojito 再打开两次生效，系统页底部版本号 ${updateId.slice(0, 8)}`,
])
console.log(`updateId ${updateId}  runtime ${fingerprint}`)
