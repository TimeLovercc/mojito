// 发布成功后往 app 推一条通知（docs/api.md"每次更新都推送通知"）：
// POST /events，kind=log、tier=digest，令牌取 $MOJITO_SECRETS_DIR/cards.env（source:cards）
// 用法：node scripts/notify.mjs --title "<标题>" --body "<正文>"
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { title: { type: 'string' }, body: { type: 'string' } } })
if (values.title === undefined) throw new Error('缺 --title')
if (values.body === undefined) throw new Error('缺 --body')

const secretsDir = process.env.MOJITO_SECRETS_DIR
if (secretsDir === undefined || secretsDir === '') throw new Error('MOJITO_SECRETS_DIR 未设置（mobile/.env）：放 cards.env 的仓库外目录')
const envFile = join(secretsDir, 'cards.env')
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
for (const k of ['MOJITO_HUB_URL', 'MOJITO_CARDS_TOKEN']) if (!(k in env)) throw new Error(`${envFile} 缺 ${k}`)

const res = await fetch(`${env.MOJITO_HUB_URL.replace(/\/+$/, '')}/events`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.MOJITO_CARDS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    kind: 'log',
    tier: 'digest',
    item_id: null,
    project_id: null,
    repo_path: null,
    title: values.title,
    body: values.body,
    evidence: null,
  }),
})
if (!res.ok) throw new Error(`推送失败 ${res.status}：${await res.text()}`)
console.log(`已推送：${values.title}`)
