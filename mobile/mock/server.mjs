// mojito 假服务器：按 docs/api.md 的 app 接口和响应结构返回数据，内容是虚构用户 Sam 的示例数据：
// docs/seed.example.json + mock/extra.json，都由 examples/demo/demo_data.py mock 生成，不要手改。
// 示例数据按生成那天（demo_day）写好，时间是当地钟点；启动时整体平移到用户时区的今天，钟点不变。
// 只在内存里改状态，重启即回到种子。
// 用法：MOCK_TOKEN=dev PORT=8788 MOCK_LANGUAGE=zh node mock/server.mjs（时区读 mobile/.env，见 .env.example）
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'

const TOKEN = process.env.MOCK_TOKEN
const PORT = Number(process.env.PORT)
// 界面语言（design.md 8.9）：zh / en，写进假服务器的 settings.language
const LANGUAGE = process.env.MOCK_LANGUAGE
if (!TOKEN) throw new Error('MOCK_TOKEN 未设置')
if (!PORT) throw new Error('PORT 未设置')
if (LANGUAGE !== 'zh' && LANGUAGE !== 'en') throw new Error(`MOCK_LANGUAGE 要是 zh 或 en，现在是 ${LANGUAGE}`)

const here = dirname(fileURLToPath(import.meta.url))
// 时区和 app 是同一个值：mobile/.env 的 EXPO_PUBLIC_MOJITO_TIMEZONE（app 构建时也读它），不另外配置
process.loadEnvFile(join(here, '../.env'))
const TIMEZONE = process.env.EXPO_PUBLIC_MOJITO_TIMEZONE
if (!TIMEZONE) throw new Error('mobile/.env 里没有时区（见 mobile/.env.example）')
const seed = JSON.parse(readFileSync(join(here, '../../docs/seed.example.json'), 'utf8'))
// 种子没有数据源、interrupt 记录、草稿计划、待确认事项、日程和订阅；extra.json 是假服务器专用的演示数据
const extra = JSON.parse(readFileSync(join(here, 'extra.json'), 'utf8'))
if (seed.demo_day !== extra.demo_day) {
  throw new Error(`seed.example.json（${seed.demo_day}）和 extra.json（${extra.demo_day}）不是同一次生成的`)
}

// hub 输出的 datetime 一律 UTC（docs/api.md）。示例数据里的时间取当地钟点（前 19 位），日期平移 SHIFT_DAYS 天，
// 再按用户时区（TIMEZONE）换成 UTC；无论在哪个时区跑，示例的今天都是今天
const tzYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d)
// 用户时区的某日某时（HH:MM:SS）→ UTC ISO
function zonedIso(ymd, hms) {
  const guess = Date.parse(`${ymd}T${hms}Z`)
  const shown = new Date(guess).toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T') + 'Z'
  return new Date(guess - (Date.parse(shown) - guess)).toISOString()
}
const DAY_MS = 86400000
const SHIFT_DAYS = Math.round((Date.parse(tzYmd(new Date())) - Date.parse(seed.demo_day)) / DAY_MS)
const shiftYmd = (ymd) => new Date(Date.parse(ymd) + SHIFT_DAYS * DAY_MS).toISOString().slice(0, 10)
const toUtc = (v) => (v === null ? null : zonedIso(shiftYmd(v.slice(0, 10)), v.slice(11, 19)))
const goals = seed.goals
// revises 是后加的字段，种子计划都不是修订版
const plans = [...seed.plans, ...extra.plans].map((p) => ({
  revises: null,
  ...p,
  start: shiftYmd(p.start),
  end: shiftYmd(p.end),
  created_at: toUtc(p.created_at),
  closed_at: toUtc(p.closed_at),
}))
// 事项的 project_id 来自 seed.json 的 item_projects（假服务器专用事项在 extra.json 里自带）
const items = [...seed.items.map((i) => ({ ...i, project_id: seed.item_projects[i.id] })), ...extra.items].map((i) => ({
  ...i,
  next_at: toUtc(i.next_at),
  updated_at: toUtc(i.updated_at),
}))
// 种子项目没有现状总结；extra.json 的 project_summaries 给个别项目补上演示用的一句话
const noSummary = { summary: null, summary_evidence: null, summary_at: null }
const projects = [
  ...seed.projects.map((p) => ({
    ...p,
    status: 'active',
    ...(p.id in extra.project_summaries ? extra.project_summaries[p.id] : noSummary),
  })),
  ...extra.projects,
].map((p) => ({ ...p, summary_at: toUtc(p.summary_at) }))
const snapshots = Object.fromEntries(
  Object.entries(extra.snapshots).map(([id, s]) => [
    id,
    {
      ...s,
      taken_at: toUtc(s.taken_at),
      worktrees: s.worktrees.map((w) => ({ ...w, last_activity_at: toUtc(w.last_activity_at) })),
      commits: s.commits.map((x) => ({ ...x, at: toUtc(x.at) })),
    },
  ]),
)
const auth = extra.auth
const usage = []
const records = [...seed.records, ...extra.records].map((r) => ({
  undo: null,
  undone_at: null,
  project_id: null,
  attachments: [],
  card_id: null,
  feedback_id: null,
  category: null,
  ...r,
  at: toUtc(r.at),
}))
  .sort((a, b) => a.at.localeCompare(b.at)) // 列表按数组顺序，旧的在前
// 简报标题里的日期（worker 写成"今日 AI 简报 · 9/30"）跟着示例数据一起平移到今天
const shiftedTitle = (c) => {
  if (c.kind !== 'brief') return c.title
  const [, m, d] = shiftYmd(c.at.slice(0, 10)).split('-')
  return c.title.replace(/\d+\/\d+$/, `${Number(m)}/${Number(d)}`)
}
const cards = extra.cards.map((c) => ({ body: null, ...c, at: toUtc(c.at), title: shiftedTitle(c) }))
// 信息流改成报告（design.md 8.10）：每日 AI 简报、实验室新动态卡和那条新动态推送记录都在 extra.json（上面已读进来）
// 卡片配图（design.md 8.5）：假服务器拿 widget 小图标当配图，挂在附件里
const MOCK_COVER = 'a-mock-cover'
const mockCoverData = readFileSync(join(here, '../assets/widget-avatar.png'))
// 订阅（design.md 8.10）：每日 AI 简报、实验室动态、每日邮件，和 hub 一样；内容（名称按语言）在 extra.json
const subscriptions = extra.subscriptions.map((s) => ({ ...s, last_run_at: toUtc(s.last_run_at) }))
const feedback = extra.feedback.map((f) => ({ ...f, at: toUtc(f.at), updated_at: toUtc(f.updated_at) }))
const feedbackMessages = extra.feedback_messages.map((m) => ({ ...m, at: toUtc(m.at) }))
const taste = extra.taste.map((t) => ({ ...t, at: toUtc(t.at), retired: false }))
let lastCardReadId = null // 按写入顺序，越后越新
const drafts = extra.drafts.map((d) => ({ ...d, at: toUtc(d.at) }))
const reviews = new Map(extra.reviews.map((r) => [r.plan_id, { ...r, created_at: toUtc(r.created_at) }]))
const sources = extra.sources.map((x) => ({ ...x, last_seen_at: toUtc(x.last_seen_at) }))
const jobs = []
let lastReadId = null
let seq = 0

const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}-${Date.now()}-${++seq}`

class HttpError extends Error {
  constructor(status, detail) {
    super(detail)
    this.status = status
  }
}

const OPEN_STATUSES = ['active', 'waiting_you', 'scheduled']
const WEEK = 7 * 86400 * 1000
// 过期：next_at 早于用户时区的今天 00:00
const isLate = (i) => i.next_at !== null && tzYmd(new Date(i.next_at)) < tzYmd(new Date())
const isStale = (i) => Date.parse(i.updated_at) < Date.now() - WEEK
// 逾期（琥珀）：进行中、过期、7 天内有动静；被忘了（红）：进行中、没有 next_at 或过期且 7 天没动静（docs/api.md"今日重点 v3"）
const isOverdue = (i) => OPEN_STATUSES.includes(i.status) && isLate(i) && !isStale(i)
const isForgotten = (i) => OPEN_STATUSES.includes(i.status) && (i.next_at === null || (isLate(i) && isStale(i)))

function withForgotten(item) {
  return { ...item, forgotten: isForgotten(item) }
}

function sourceView(s) {
  const alive = s.last_seen_at !== null && Date.parse(s.last_seen_at) > Date.now() - s.expected_interval_s * 1000
  return { health: null, health_detail: null, health_at: null, ...s, alive }
}

function findItem(id) {
  const item = items.find((i) => i.id === id)
  if (!item) throw new HttpError(404, `item ${id} 不存在`)
  return item
}

function findPlan(id) {
  const plan = plans.find((p) => p.id === id)
  if (!plan) throw new HttpError(404, `plan ${id} 不存在`)
  return plan
}

function require(body, key) {
  if (!(key in body)) throw new HttpError(422, `缺字段 ${key}`)
  return body[key]
}

function byNextAt(a, b) {
  if (a.next_at === null) return 1
  if (b.next_at === null) return -1
  return Date.parse(a.next_at) - Date.parse(b.next_at)
}

function recordsNewestFirst() {
  return records.slice().reverse()
}

function unreadRecords() {
  const newest = recordsNewestFirst()
  if (lastReadId === null) return newest
  const idx = newest.findIndex((r) => r.id === lastReadId)
  return newest.slice(0, idx)
}

// 每个 Plan 输出时带上 review_status
function planView(plan) {
  return { ...plan, review_status: reviews.has(plan.id) ? reviews.get(plan.id).status : 'none' }
}

function planDetail(plan) {
  return {
    plan: planView(plan),
    goals: goals.filter((g) => plan.goal_ids.includes(g.id)),
    items: plan.item_ids.map((id) => withForgotten(findItem(id))),
    review: reviews.has(plan.id) ? reviews.get(plan.id) : null,
  }
}

// 带 item_id 时 project_id 取事项的；否则用传进来的 project_id（系统记录为 null）
function addRecord(fields) {
  const base = {
    id: newId('r'),
    at: now(),
    evidence: null,
    needs_processing: false,
    undo: null,
    undone_at: null,
    project_id: null,
    attachments: [],
    card_id: null,
    feedback_id: null,
    category: null,
    ...fields,
  }
  const record = base.item_id === null ? base : { ...base, project_id: findItem(base.item_id).project_id }
  records.push(record)
  return record
}

function newJob(kind, runner, recordId) {
  const job = {
    id: newId('j'),
    kind,
    runner,
    record_id: recordId,
    payload: null,
    status: 'queued',
    requested_at: now(),
    started_at: null,
    finished_at: null,
    error: null,
  }
  jobs.push(job)
  return job
}

// 假服务器里 Mac 一直"睡着"：runner=mac 的对话任务停在 queued。refresh 例外，照常跑完便于演示
const macAsleep = (job) => job.runner === 'mac' && job.kind === 'chat_reply'

// 模拟执行者：chat_reply 1.5 秒后 running、4 秒后回复；其他任务 3 秒后 running、7 秒后 done
function advanceJob(job) {
  if (macAsleep(job)) return job
  const age = Date.now() - Date.parse(job.requested_at)
  const [startAt, doneAt] = job.kind === 'chat_reply' ? [1500, 4000] : [3000, 7000]
  if (job.status === 'queued' && age > startAt) {
    job.status = 'running'
    job.started_at = now()
  }
  if (job.status === 'running' && age > doneAt) {
    job.status = 'done'
    job.finished_at = now()
    if (job.kind === 'chat_reply') replyTo(job)
    if (job.kind === 'undo') undoDone(job)
    if (job.kind === 'process_note') processNote(job)
    if (job.kind === 'draft_review') draftReview()
    if (job.kind === 'calendar_delete') calendarDeleted(job)
    if (job.kind === 'refresh') {
      addRecord({
        author: 'system',
        source: 'hub',
        kind: 'log',
        tier: 'digest',
        item_id: null,
        title: say('更新好了', 'Refreshed'),
        body: say('假服务器模拟的刷新完成。', 'The demo hub simulated a refresh.'),
      })
    }
  }
  return job
}

// 模拟服务器 agent 回复；提到"邮件"或 mail 就转给 Mac（需要本地登录态）
function replyTo(job) {
  const msg = records.find((r) => r.id === job.record_id)
  const reply = (tier, body) =>
    addRecord({ author: 'system', source: 'server-agent', kind: 'chat', tier, item_id: msg.item_id, title: body.slice(0, 40), body })
  if (/邮件|\bmail\b|\bemail\b/i.test(msg.body)) {
    reply('log', say('需要读邮件 → 已转给 Mac，醒来后回你', 'This needs your mail → passed to your Mac; it will answer when it wakes up'))
    newJob('chat_reply', 'mac', msg.id)
    return
  }
  const topic = msg.item_id === null ? null : items.find((i) => i.id === msg.item_id).title
  const images = msg.attachments.length
  const got = [images === 0 ? null : `${images} image${images === 1 ? '' : 's'}`, msg.body === '' ? null : `"${msg.body.length > 40 ? `${msg.body.slice(0, 40)}…` : msg.body}"`]
  reply(
    'digest',
    say(
      `假服务器回复${topic === null ? '' : `（关于「${topic}」）`}：收到${images === 0 ? '' : ` ${images} 张图`}${msg.body === '' ? '' : `「${msg.body.slice(0, 30)}」`}。真实回复由服务器 agent 看图/读文字后生成。`,
      `Demo reply${topic === null ? '' : ` (about "${topic}")`}: got ${got.filter((g) => g !== null).join(' and ')}. In a real instance, the agent on your server reads it and writes the answer.`,
    ),
  )
}

const advanceAll = () => jobs.forEach(advanceJob)

// 模拟 Mac 整理笔记（docs/api.md"简化"）：提到"想法"就只留作笔记，其余直接变成进行中的事项，并写一条可撤销的"由笔记记成事项"
function processNote(job) {
  const note = records.find((r) => r.id === job.record_id)
  if (/想法|\bidea\b/i.test(note.title)) return
  const item = {
    id: `note-${note.id}`,
    title: note.title,
    category: 'life',
    status: 'active',
    next_step: say('先定一个今天能做的小步', 'Pick one small step you can do today'),
    next_at: null,
    owner: 'me',
    done_definition: say('这件事办完', 'This is done'),
    goal_id: null,
    progress: null,
    updated_at: now(),
    updated_by: 'worker',
    project_id: null,
  }
  items.push(item)
  note.item_id = item.id
  addRecord({
    author: 'system',
    source: 'hub',
    kind: 'log',
    tier: 'log',
    item_id: item.id,
    title: say(`由笔记记成事项：${item.title}`, `Turned the note into a task: ${item.title}`),
    body: '',
    undo: { type: 'item_create', item_id: item.id },
  })
  addRecord({ author: 'system', source: 'worker', kind: 'chat', tier: 'log', item_id: null, title: say(`已记成事项：${item.title}`, `Saved as a task: ${item.title}`), body: '' })
}

// 模拟服务器 agent 撤销：反向操作后写一条说明，hub 在原记录上标 undone_at
// hub 改事项时对每个改了的字段写一条带撤销的记录（docs/api.md"补充"第 3 条）
function changeItem(item, change, source) {
  const before = {}
  for (const [k, v] of Object.entries(change)) {
    if (item[k] === v) continue
    before[k] = item[k]
    addRecord({
      author: 'system',
      source,
      kind: 'log',
      tier: 'log',
      item_id: item.id,
      title: `${item.title}：${k} 从 ${item[k]} 改成 ${v}`,
      body: '',
      undo: { type: 'item', item_id: item.id, before: { [k]: item[k] } },
    })
    item[k] = v
  }
  item.updated_at = now()
  item.updated_by = source
}

function undoDone(job) {
  const original = records.find((r) => r.id === job.record_id)
  original.undone_at = now()
  if (original.undo.type === 'calendar') deletedEvents.delete(`${original.undo.event_id}@${original.undo.before.start}`)
  if (original.undo.type === 'subscription') Object.assign(findSubscription(original.undo.subscription_id), original.undo.before)
  addRecord({
    author: 'system',
    source: 'server-agent',
    kind: 'log',
    tier: 'log',
    item_id: original.item_id,
    title: say(`已撤销：${original.title}`, `Undone: ${original.title}`),
    body: '',
  })
}

// 模拟 Mac 起草复盘：按事项状态算完成/没完成，并起草下一期（没有草稿计划时）
function draftReview() {
  const active = plans.find((p) => p.status === 'active')
  if (active === undefined || (reviews.has(active.id) && reviews.get(active.id).status === 'done')) return
  const done = active.item_ids.filter((id) => findItem(id).status === 'done')
  reviews.set(active.id, {
    plan_id: active.id,
    created_at: now(),
    summary: extra.simulated_review.summary,
    completed_item_ids: done,
    missed_item_ids: active.item_ids.filter((id) => !done.includes(id)),
    patterns: extra.simulated_review.patterns,
    user_note: null,
    status: 'draft',
  })
  addRecord({
    author: 'system',
    source: 'hub',
    kind: 'alert',
    tier: 'interrupt',
    item_id: null,
    title: say('该复盘了', 'Time for a review'),
    body: say(`第 ${active.start} 起的这期计划有了复盘草稿。`, `The plan starting ${active.start} has a review draft.`),
  })
}

// 删掉的日程（calendar_delete 跑完后，按 uid@start 记，重复日程只删那一次）；撤销时从这里拿掉
const deletedEvents = new Set()

// 模拟服务器 agent 删日程：从日历拿掉，写一条可撤销的说明（design.md 8.5）
function calendarDeleted(job) {
  const ev = allEvents().find((e) => e.uid === job.payload.uid && e.start === job.payload.start)
  if (!ev) throw new HttpError(404, `日程 ${job.payload.uid} 不存在`)
  deletedEvents.add(`${ev.uid}@${ev.start}`)
  addRecord({
    author: 'agent',
    source: 'server-agent',
    kind: 'log',
    tier: 'log',
    item_id: null,
    title: say(`删除了日程：${ev.title}`, `Deleted the event: ${ev.title}`),
    body: say(`删除了日程：${ev.title}（${ev.start}）`, `Deleted the event: ${ev.title} (${ev.start})`),
    undo: { type: 'calendar', op: 'delete', event_id: ev.uid, before: ev },
  })
}

function mockEvents() {
  return allEvents().filter((e) => !deletedEvents.has(`${e.uid}@${e.start}`))
}

// 假日程：extra.json 的 events（和 demo hub 的 calendar.ics 同一份，都不是订阅日历：read_only=false），和其他示例数据一起平移
const EVENTS = extra.events.map((e) => ({ ...e, start: toUtc(e.start), end: toUtc(e.end) }))
function allEvents() {
  return EVENTS
}

// notify：按类型开关推送（design.md 8.6），迁移时补全为全开
const settings = { ...seed.settings, language: LANGUAGE, notify: { brief: true, chat: true, alert: true, news: true, feedback: true, release: true, jobs: true } }
// 假服务器自己写的文字跟界面语言走（settings.language 可在 app 里切换）
const say = (zh, en) => (settings.language === 'en' ? en : zh)

function findSubscription(id) {
  const sub = subscriptions.find((x) => x.id === id)
  if (!sub) throw new HttpError(404, `subscription ${id} 不存在`)
  return sub
}

function findProject(id) {
  const p = projects.find((x) => x.id === id)
  if (!p) throw new HttpError(404, `project ${id} 不存在`)
  return p
}

const OPEN = ['active', 'waiting_you', 'scheduled']
const WEEK_MS = 7 * 86400 * 1000

// hub 计算的三项：last_activity_at（记录和快照里最新的时间）、stale、open_items
function projectView(p) {
  const times = records.filter((r) => r.project_id === p.id).map((r) => r.at)
  if (p.id in snapshots) times.push(snapshots[p.id].taken_at)
  const last = times.length === 0 ? null : times.sort().at(-1)
  return {
    ...p,
    last_activity_at: last,
    stale: p.status === 'active' && (last === null || Date.parse(last) < Date.now() - WEEK_MS),
    open_items: items.filter((i) => i.project_id === p.id && OPEN.includes(i.status)).length,
  }
}

const USAGE_VIEWS = [
  'today',
  'plan_current',
  'plan_history',
  'plan_detail',
  'projects',
  'project_detail',
  'items',
  'item_detail',
  'feed',
  'card_detail',
  'timeline',
  'notes',
  'feedback_sheet',
  'app_open',
  'chat',
  'system',
  'note_sheet',
  'widget_today',
  'widget_note',
  'push_open',
]
const USAGE_ACTIONS = [
  'note',
  'decision',
  'refresh',
  'chat_send',
  'item_ask',
  'undo',
  'draft_copy',
  'draft_resolve',
  'review_finish',
  'review_start',
  'settings_save',
  'open_orca',
  'inline_reply',
  'card_save',
  'card_dismiss',
  'card_ask',
  'card_to_item',
  'client_error',
  'feedback_send',
  'feedback_decision',
  'push_enable',
  'push_disable',
]

// 网页推送（docs/api.md "Web Push 接口"）：假服务器只存订阅、不真发。公钥是启动时现生成的 P-256，格式和 hub 一样
const vapidPublicKey = (() => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' })
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url')
})()
const webpushSubscriptions = new Map()
const PUSH_HOSTS = ['push.apple.com', 'push.services.mozilla.com', 'notify.windows.com']

function checkEndpoint(endpoint) {
  const u = new URL(endpoint)
  const host = u.hostname.toLowerCase()
  const allowed = host === 'fcm.googleapis.com' || PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || !['', '443'].includes(u.port) || !allowed) {
    throw new HttpError(422, 'endpoint 不在白名单')
  }
}

// /pulse 的游标就是记录条数；records 带 category（假数据没有这个字段，按 kind / tier 推断）
const PUSH_TIERS = ['interrupt', 'digest', 'quiet']
const categoryOf = (r) => (r.kind === 'chat' ? 'chat' : r.tier === 'interrupt' ? 'alert' : 'jobs')

const routes = [
  [
    'GET',
    /^\/pulse$/,
    (m, q) => {
      const limit = Number(require(Object.fromEntries(q), 'limit'))
      const after = q.has('after') ? Number(q.get('after')) : records.length
      const fresh = records.slice(after).filter((r) => PUSH_TIERS.includes(r.tier))
      const page = fresh.slice(0, limit)
      const cursor = page.length < fresh.length ? records.indexOf(page[page.length - 1]) + 1 : records.length
      const n = routes.find(([method, re]) => method === 'GET' && re.test('/today'))[2]().needs_you
      return {
        cursor: String(cursor),
        records: page.map((r) => ({ ...r, category: categoryOf(r) })),
        more: page.length < fresh.length,
        counts: { due_today: 0, needs_you: n.items.length + n.plans.length + n.drafts.length + n.projects.length + n.feedback.length },
      }
    },
  ],
  ['GET', /^\/webpush\/vapid-public-key$/, () => ({ public_key: vapidPublicKey })],
  [
    'POST',
    /^\/webpush\/subscriptions$/,
    (m, q, body, req) => {
      const endpoint = require(body, 'endpoint')
      const keys = require(body, 'keys')
      checkEndpoint(endpoint)
      if (Buffer.from(require(keys, 'p256dh'), 'base64url').length !== 65) throw new HttpError(422, 'p256dh 长度不对')
      if (Buffer.from(require(keys, 'auth'), 'base64url').length !== 16) throw new HttpError(422, 'auth 长度不对')
      const ua = req.headers['user-agent']
      if (ua === undefined) throw new HttpError(422, '缺 User-Agent')
      if (!webpushSubscriptions.has(endpoint) && webpushSubscriptions.size >= 20) throw new HttpError(422, '订阅已满 20 条')
      webpushSubscriptions.set(endpoint, { keys, user_agent: ua.slice(0, 200), registered_at: now() })
      console.log(`webpush 订阅 ${webpushSubscriptions.size} 条：${new URL(endpoint).host}  ${ua.slice(0, 80)}`)
    },
  ],
  [
    'POST',
    /^\/webpush\/subscriptions\/delete$/,
    (m, q, body) => {
      webpushSubscriptions.delete(require(body, 'endpoint'))
      console.log(`webpush 订阅剩 ${webpushSubscriptions.size} 条`)
    },
  ],
  [
    'GET',
    /^\/today$/,
    () => {
      const active = plans.find((p) => p.status === 'active')
      const all = items.map(withForgotten)
      // 今日重点 v3：今天到期的全部 + 今天之后最近的一件；每条带 days_until
      const today = tzYmd(new Date())
      const dated = all.filter((i) => OPEN_STATUSES.includes(i.status) && i.next_at !== null).sort(byNextAt)
      const dueToday = dated.filter((i) => tzYmd(new Date(i.next_at)) === today)
      const next = dated.find((i) => tzYmd(new Date(i.next_at)) > today)
      const focus = [...dueToday, ...(next === undefined ? [] : [next])].map((i) => ({
        ...i,
        days_until: Math.round((Date.parse(tzYmd(new Date(i.next_at))) - Date.parse(today)) / 86400000),
      }))
      return {
        generated_at: now(),
        plan: active === undefined ? null : planView(active),
        focus,
        needs_you: {
          items: all.filter((i) => i.status === 'waiting_you'),
          plans: plans.filter((p) => p.status === 'draft').map(planView),
          drafts: drafts.filter((d) => d.status === 'pending'),
          projects: projects.filter((p) => p.status === 'proposed').map(projectView),
          feedback: feedback.filter((f) => f.status === 'awaiting_approval'),
        },
        overdue: all.filter(isOverdue),
        forgotten: all.filter((i) => i.forgotten),
        alerts: unreadRecords().filter((r) => r.tier === 'interrupt'),
        schedule: mockEvents().filter((e) => tzYmd(new Date(e.start)) === tzYmd(new Date())),
      }
    },
  ],
  ['GET', /^\/goals$/, () => ({ goals })],
  [
    'GET',
    /^\/plans\/current$/,
    () => {
      const active = plans.find((p) => p.status === 'active')
      if (!active) throw new HttpError(404, '没有 active plan')
      return planDetail(active)
    },
  ],
  [
    'GET',
    /^\/plans$/,
    () => ({
      plans: plans
        .slice()
        .sort((a, b) => b.start.localeCompare(a.start))
        .map(planView),
    }),
  ],
  ['GET', /^\/plans\/([^/]+)$/, (m) => planDetail(findPlan(m[1]))],
  [
    'POST',
    /^\/plans\/([^/]+)\/approve$/,
    (m) => {
      const plan = findPlan(m[1])
      if (plan.status !== 'draft') throw new HttpError(409, `plan ${plan.id} 不是 draft`)
      // 没复盘不开新一期
      // 修订版不要求复盘；批准后被修订的计划置 closed
      const blocking =
        plan.revises === null
          ? plans.find((p) => p.status !== 'draft' && p.end < plan.start && planView(p).review_status !== 'done')
          : undefined
      if (blocking !== undefined) throw new HttpError(409, `计划 ${blocking.id} 还没复盘完`)
      for (const p of plans) {
        if (p.status === 'active') {
          p.status = 'closed'
          p.closed_at = now()
        }
      }
      plan.status = 'active'
      return planView(plan)
    },
  ],
  [
    'GET',
    /^\/items$/,
    (m, q) => {
      let list = items.map(withForgotten)
      if (q.has('category')) list = list.filter((i) => i.category === q.get('category'))
      if (q.has('status')) list = list.filter((i) => i.status === q.get('status'))
      if (q.has('forgotten')) list = list.filter((i) => i.forgotten === (q.get('forgotten') === 'true'))
      return { items: list }
    },
  ],
  [
    'GET',
    /^\/items\/([^/]+)$/,
    (m) => {
      const item = withForgotten(findItem(m[1]))
      return { item, records: recordsNewestFirst().filter((r) => r.item_id === item.id) }
    },
  ],
  [
    'POST',
    /^\/items\/([^/]+)\/decision$/,
    (m, q, body) => {
      const item = findItem(m[1])
      const action = require(body, 'action')
      const changes = {
        approve: { status: 'active' },
        decline: { status: 'closed' },
        done: { status: 'done' },
        close: { status: 'closed' },
        reopen: { status: 'active' },
      }
      let change
      if (action === 'postpone') change = { next_at: require(body, 'until') }
      else if (action in changes) change = changes[action]
      else throw new HttpError(422, `未知 action ${action}`)
      if (action === 'reopen' && item.status !== 'done' && item.status !== 'closed')
        throw new HttpError(409, '只有已完成/已关闭的事项能重新打开')
      const label = { approve: '同意', decline: '不要', postpone: `推迟到 ${body.until}`, done: '完成', close: '关闭', reopen: '重新打开' }[
        action
      ]
      addRecord({ author: 'me', source: 'app', kind: 'decision', tier: 'log', item_id: item.id, title: `拍板：${label}`, body: item.title })
      changeItem(item, change, 'app')
      return withForgotten(item)
    },
  ],
  [
    'GET',
    /^\/records$/,
    (m, q) => {
      if (!q.has('limit')) throw new HttpError(422, '缺参数 limit')
      const limit = Number(q.get('limit'))
      let list = recordsNewestFirst().filter((r) => q.get('include_hidden') === 'true' || r.hidden_at === undefined)
      for (const k of ['kind', 'author', 'project_id']) if (q.has(k)) list = list.filter((r) => r[k] === q.get(k))
      if (q.has('before')) {
        const idx = list.findIndex((r) => r.id === q.get('before'))
        if (idx === -1) throw new HttpError(404, `record ${q.get('before')} 不存在`)
        list = list.slice(idx + 1)
      }
      return { records: list.slice(0, limit), last_read_id: lastReadId }
    },
  ],
  [
    'GET',
    /^\/records\/([^/]+)$/,
    (m) => {
      const record = records.find((r) => r.id === m[1])
      if (!record) throw new HttpError(404, `record ${m[1]} 不存在`)
      return record
    },
  ],
  [
    'POST',
    /^\/records$/,
    (m, q, body) => {
      const itemId = require(body, 'item_id')
      const projectId = require(body, 'project_id')
      if (itemId !== null) findItem(itemId)
      if (projectId !== null) findProject(projectId)
      // 笔记带图（design.md 8.6）：规则同 POST /chat
      const ids = require(body, 'attachment_ids')
      if (ids.length > 4) throw new HttpError(422, '最多 4 张图')
      for (const id of ids) {
        if (!attachments.has(id)) throw new HttpError(422, `attachment ${id} 不存在`)
        if (attachments.get(id).used) throw new HttpError(422, `attachment ${id} 已被别的消息用过`)
      }
      ids.forEach((id) => (attachments.get(id).used = true))
      const record = addRecord({
        author: 'me',
        source: 'app',
        kind: 'note',
        project_id: projectId,
        tier: 'log',
        item_id: itemId,
        title: require(body, 'title'),
        body: require(body, 'body'),
        needs_processing: require(body, 'needs_processing'),
        attachments: ids.map((id) => attachments.get(id).meta),
      })
      if (record.needs_processing) {
        newJob('process_note', 'mac', record.id)
      }
      return record
    },
  ],
  [
    'POST',
    /^\/reads$/,
    (m, q, body) => {
      const id = require(body, 'record_id')
      if (!records.some((r) => r.id === id)) throw new HttpError(404, `record ${id} 不存在`)
      lastReadId = id
      return undefined // 204
    },
  ],
  [
    'POST',
    /^\/jobs$/,
    (m, q, body) => {
      const kind = require(body, 'kind')
      if (kind !== 'refresh' && kind !== 'draft_review') throw new HttpError(422, 'app 只能提交 refresh / draft_review')
      return newJob(kind, 'mac', null)
    },
  ],
  [
    'GET',
    /^\/jobs\/([^/]+)$/,
    (m) => {
      const job = jobs.find((j) => j.id === m[1])
      if (!job) throw new HttpError(404, `job ${m[1]} 不存在`)
      return advanceJob(job)
    },
  ],
  ['GET', /^\/sources$/, () => ({ sources: sources.map(sourceView) })],
  [
    'GET',
    /^\/jobs$/,
    (m, q) => {
      let list = jobs.slice().reverse()
      if (q.has('status')) list = list.filter((j) => j.status === q.get('status'))
      if (q.has('runner')) list = list.filter((j) => j.runner === q.get('runner'))
      return { jobs: list.slice(0, 50) }
    },
  ],
  [
    'POST',
    /^\/chat$/,
    (m, q, body) => {
      const text = require(body, 'body')
      const itemId = require(body, 'item_id')
      const ids = require(body, 'attachment_ids')
      const cardId = require(body, 'card_id')
      if (cardId !== null && !cards.some((c) => c.id === cardId)) throw new HttpError(422, `card ${cardId} 不存在`)
      if (ids.length > 4) throw new HttpError(422, '最多 4 张图')
      if (text === '' && ids.length === 0) throw new HttpError(422, 'body 为空时必须带图')
      for (const id of ids) {
        if (!attachments.has(id)) throw new HttpError(422, `attachment ${id} 不存在`)
        if (attachments.get(id).used) throw new HttpError(422, `attachment ${id} 已被别的消息用过`)
      }
      ids.forEach((id) => (attachments.get(id).used = true))
      const projectId = require(body, 'project_id')
      if (itemId !== null) findItem(itemId)
      if (projectId !== null) findProject(projectId)
      const record = addRecord({
        author: 'me',
        source: 'app',
        kind: 'chat',
        project_id: projectId,
        tier: 'log',
        item_id: itemId,
        title: text === '' ? '[图片]' : text.slice(0, 40),
        body: text,
        attachments: ids.map((id) => attachments.get(id).meta),
      })
      return { record, job: newJob('chat_reply', 'server', record.id) }
    },
  ],
  [
    'GET',
    /^\/chat$/,
    (m, q) => {
      if (!q.has('limit')) throw new HttpError(422, '缺参数 limit')
      let list = recordsNewestFirst().filter((r) => r.kind === 'chat')
      if (q.has('item_id')) list = list.filter((r) => r.item_id === q.get('item_id'))
      if (q.has('project_id')) list = list.filter((r) => r.project_id === q.get('project_id'))
      if (q.has('before')) {
        const idx = list.findIndex((r) => r.id === q.get('before'))
        if (idx === -1) throw new HttpError(404, `record ${q.get('before')} 不存在`)
        list = list.slice(idx + 1)
      }
      return { records: list.slice(0, Number(q.get('limit'))) }
    },
  ],
  ['GET', /^\/settings$/, () => settings],
  [
    'GET',
    /^\/metrics$/,
    (m, q) => {
      if (!q.has('from') || !q.has('to')) throw new HttpError(422, '缺参数 from/to')
      // 假服务器：按日期造一组稳定的演示数字
      const days = []
      for (let d = q.get('from'); d <= q.get('to'); d = tzYmd(new Date(Date.parse(d) + 36 * 3600000))) {
        const n = Number(d.slice(-2))
        days.push({ date: d, opens: (n % 5) + 1, evening_asked: 1, evening_replied: n % 3 === 0 ? 0 : 1 })
      }
      const sum = (k) => days.reduce((a, x) => a + x[k], 0)
      return { days, totals: { opens: sum('opens'), evening_asked: sum('evening_asked'), evening_replied: sum('evening_replied') } }
    },
  ],
  [
    'POST',
    /^\/feedback$/,
    (m, q, body) => {
      const text = require(body, 'body')
      const ids = require(body, 'attachment_ids')
      const context = require(body, 'context')
      for (const k of ['screen', 'item_id', 'project_id', 'app_update_id']) require(context, k)
      for (const id of ids) {
        if (!attachments.has(id)) throw new HttpError(422, `attachment ${id} 不存在`)
        attachments.get(id).used = true
      }
      const fb = {
        id: newId('f'),
        at: now(),
        body: text,
        attachments: ids.map((id) => attachments.get(id).meta),
        context,
        status: 'open',
        ship_mode: null,
        summary: null,
        updated_at: now(),
      }
      feedback.push(fb)
      addRecord({
        author: 'me',
        source: 'app',
        kind: 'feedback',
        tier: 'log',
        item_id: null,
        title: text === '' ? '[反馈截图]' : text.slice(0, 40),
        body: text,
      })
      console.log('feedback context', JSON.stringify(context))
      return fb
    },
  ],
  [
    'GET',
    /^\/feedback\/([^/]+)$/,
    (m) => {
      const fb = feedback.find((f) => f.id === m[1])
      if (!fb) throw new HttpError(404, `feedback ${m[1]} 不存在`)
      return fb
    },
  ],
  ['GET', /^\/feedback\/([^/]+)\/messages$/, (m) => ({ messages: feedbackMessages.filter((x) => x.feedback_id === m[1]) })],
  [
    'POST',
    /^\/feedback\/([^/]+)\/messages$/,
    (m, q, body) => {
      if (!feedback.some((f) => f.id === m[1])) throw new HttpError(404, `feedback ${m[1]} 不存在`)
      const ids = require(body, 'attachment_ids')
      const msg = {
        id: newId('fm'),
        feedback_id: m[1],
        at: now(),
        author: 'me',
        body: require(body, 'body'),
        attachments: ids.map((id) => attachments.get(id).meta),
      }
      feedbackMessages.push(msg)
      return msg
    },
  ],
  ['GET', /^\/taste$/, () => ({ notes: taste.filter((t) => !t.retired).map(({ retired, ...t }) => t) })],
  [
    'POST',
    /^\/taste\/([^/]+)\/retire$/,
    (m) => {
      const t = taste.find((x) => x.id === m[1])
      if (!t) throw new HttpError(404, `taste ${m[1]} 不存在`)
      t.retired = true
      const { retired, ...rest } = t
      return rest
    },
  ],
  [
    'GET',
    /^\/feedback$/,
    (m, q) => ({
      feedback: feedback.filter((f) => !q.has('status') || f.status === q.get('status')).sort((a, b) => b.at.localeCompare(a.at)),
    }),
  ],
  [
    'POST',
    /^\/feedback\/([^/]+)\/decision$/,
    (m, q, body) => {
      const fb = feedback.find((f) => f.id === m[1])
      if (!fb) throw new HttpError(404, `feedback ${m[1]} 不存在`)
      if (fb.status !== 'awaiting_approval') throw new HttpError(409, '只有等确认的反馈能拍板')
      const action = require(body, 'action')
      if (action !== 'approve' && action !== 'decline') throw new HttpError(422, `未知 action ${action}`)
      fb.status = action === 'approve' ? 'fixing' : 'declined'
      fb.updated_at = now()
      addRecord({
        author: 'me',
        source: 'app',
        kind: 'decision',
        tier: 'log',
        item_id: null,
        title: `反馈：${action === 'approve' ? '同意上线' : '不要'}`,
        body: fb.body,
      })
      return fb
    },
  ],
  [
    'GET',
    /^\/cards$/,
    (m, q) => {
      if (!q.has('limit')) throw new HttpError(422, '缺参数 limit')
      let list = cards.slice().sort((a, b) => b.at.localeCompare(a.at))
      list = list.filter((c) => (q.has('status') ? c.status === q.get('status') : c.status !== 'dismissed'))
      if (q.has('project_id')) list = list.filter((c) => c.project_id === q.get('project_id'))
      if (q.has('before')) {
        const idx = list.findIndex((c) => c.id === q.get('before'))
        if (idx === -1) throw new HttpError(404, `card ${q.get('before')} 不存在`)
        list = list.slice(idx + 1)
      }
      return { cards: list.slice(0, Number(q.get('limit'))), last_read_id: lastCardReadId }
    },
  ],
  [
    'GET',
    /^\/cards\/([^/]+)$/,
    (m) => {
      const card = cards.find((c) => c.id === m[1])
      if (!card) throw new HttpError(404, `card ${m[1]} 不存在`)
      return card
    },
  ],
  [
    'POST',
    /^\/cards\/([^/]+)\/status$/,
    (m, q, body) => {
      const card = cards.find((c) => c.id === m[1])
      if (!card) throw new HttpError(404, `card ${m[1]} 不存在`)
      const status = require(body, 'status')
      if (!['new', 'saved', 'dismissed'].includes(status)) throw new HttpError(422, `未知 status ${status}`)
      card.status = status
      return card
    },
  ],
  [
    'POST',
    /^\/card-reads$/,
    (m, q, body) => {
      const id = require(body, 'card_id')
      if (!cards.some((c) => c.id === id)) throw new HttpError(404, `card ${id} 不存在`)
      lastCardReadId = id
      return undefined // 204
    },
  ],
  [
    'POST',
    /^\/cards\/([^/]+)\/to-item$/,
    (m) => {
      const card = cards.find((c) => c.id === m[1])
      if (!card) throw new HttpError(404, `card ${m[1]} 不存在`)
      const note = addRecord({
        author: 'me',
        source: 'app',
        kind: 'note',
        tier: 'log',
        item_id: null,
        project_id: card.project_id,
        card_id: card.id,
        needs_processing: true,
        title: `从信息流：${card.title}`,
        body: `${card.summary}\n${card.link === null ? '' : card.link}`,
      })
      return newJob('process_note', 'mac', note.id)
    },
  ],
  [
    'GET',
    /^\/projects$/,
    (m, q) => {
      let list = projects.filter((p) => (q.has('status') ? p.status === q.get('status') : p.status === 'active' || p.status === 'paused'))
      if (q.has('area')) list = list.filter((p) => p.area === q.get('area'))
      return { projects: list.map(projectView) }
    },
  ],
  [
    'GET',
    /^\/projects\/([^/]+)$/,
    (m) => {
      const p = findProject(m[1])
      return {
        project: projectView(p),
        items: items.filter((i) => i.project_id === p.id).map(withForgotten),
        snapshot: p.id in snapshots ? snapshots[p.id] : null,
        records: recordsNewestFirst()
          .filter((r) => r.project_id === p.id)
          .slice(0, 50),
      }
    },
  ],
  [
    'POST',
    /^\/projects\/([^/]+)\/decision$/,
    (m, q, body) => {
      const p = findProject(m[1])
      const action = require(body, 'action')
      const next = { approve: 'active', decline: 'declined', pause: 'paused', resume: 'active', done: 'done' }
      if (!(action in next)) throw new HttpError(422, `未知 action ${action}`)
      if (action === 'approve' && p.status !== 'proposed') throw new HttpError(409, `project ${p.id} 不是 proposed`)
      p.status = next[action]
      addRecord({
        author: 'me',
        source: 'app',
        kind: 'decision',
        tier: 'log',
        item_id: null,
        project_id: p.id,
        title: `项目：${action}`,
        body: p.title,
      })
      return projectView(p)
    },
  ],
  [
    'POST',
    /^\/usage$/,
    (m, q, body) => {
      const events = require(body, 'events')
      for (const e of events) {
        for (const k of ['at', 'kind', 'name', 'detail']) if (!(k in e)) throw new HttpError(422, `usage 事件缺字段 ${k}`)
        const names = e.kind === 'view' ? USAGE_VIEWS : e.kind === 'action' ? USAGE_ACTIONS : null
        if (names === null || !names.includes(e.name)) throw new HttpError(422, `未知 usage ${e.kind}/${e.name}`)
      }
      usage.push(...events)
      console.log('usage +', events.map((e) => `${e.kind}:${e.name}`).join(' '))
      return undefined // 204
    },
  ],
  ['GET', /^\/auth-status$/, () => ({ auth: auth.map((a) => ({ ...a, checked_at: toUtc(a.checked_at) })) })],
  [
    'POST',
    /^\/records\/([^/]+)\/hide$/,
    (m) => {
      const record = records.find((r) => r.id === m[1])
      if (!record) throw new HttpError(404, `record ${m[1]} 不存在`)
      if (record.kind !== 'note' || record.author !== 'me') throw new HttpError(409, '只能删除自己的笔记')
      record.hidden_at = now()
      return record
    },
  ],
  [
    'POST',
    /^\/records\/([^/]+)\/undo$/,
    (m) => {
      const record = records.find((r) => r.id === m[1])
      if (!record) throw new HttpError(404, `record ${m[1]} 不存在`)
      if (record.undo === null || record.undone_at !== null) throw new HttpError(409, '这条记录不能撤销或已撤销')
      if (record.undo.type === 'item_create') {
        // 撤销整理：事项置 closed，笔记解除挂接；hub 直接做
        const item = findItem(record.undo.item_id)
        item.status = 'closed'
        for (const r of records) if (r.kind === 'note' && r.item_id === item.id) r.item_id = null
        record.undone_at = now()
        addRecord({ author: 'system', source: 'hub', kind: 'log', tier: 'log', item_id: item.id, title: `已撤销：${record.title}`, body: '' })
        const job = newJob('undo', 'server', record.id)
        Object.assign(job, { status: 'done', started_at: now(), finished_at: now() })
        return job
      }
      if (record.undo.type !== 'item') return newJob('undo', 'server', record.id)
      // type=item：hub 直接恢复原值，返回的 Job 直接是 done
      const item = findItem(record.undo.item_id)
      for (const [k, v] of Object.entries(record.undo.before)) item[k] = v
      record.undone_at = now()
      addRecord({ author: 'system', source: 'hub', kind: 'log', tier: 'log', item_id: item.id, title: `已撤销：${record.title}`, body: '' })
      const job = newJob('undo', 'server', record.id)
      Object.assign(job, { status: 'done', started_at: now(), finished_at: now() })
      return job
    },
  ],
  [
    'GET',
    /^\/drafts$/,
    (m, q) => ({ drafts: drafts.filter((d) => !q.has('status') || d.status === q.get('status')).sort((a, b) => b.at.localeCompare(a.at)) }),
  ],
  [
    'POST',
    /^\/drafts\/([^/]+)\/resolve$/,
    (m, q, body) => {
      const draft = drafts.find((d) => d.id === m[1])
      if (!draft) throw new HttpError(404, `draft ${m[1]} 不存在`)
      const status = require(body, 'status')
      if (status !== 'dismissed' && status !== 'sent_by_me') throw new HttpError(422, `未知 status ${status}`)
      draft.status = status
      const label = status === 'sent_by_me' ? '我已发出' : '不要'
      addRecord({
        author: 'me',
        source: 'app',
        kind: 'decision',
        tier: 'log',
        item_id: draft.item_id,
        title: `草稿：${label}`,
        body: `给 ${draft.to}：${draft.subject === null ? draft.body.slice(0, 40) : draft.subject}`,
      })
      return draft
    },
  ],
  [
    'POST',
    /^\/reviews\/([^/]+)\/finish$/,
    (m, q, body) => {
      const review = reviews.get(m[1])
      if (review === undefined) throw new HttpError(404, `plan ${m[1]} 没有复盘`)
      review.user_note = require(body, 'user_note')
      review.status = 'done'
      return review
    },
  ],
  [
    'PUT',
    /^\/settings$/,
    (m, q, body) => {
      const next = {
        morning_at: require(body, 'morning_at'),
        evening_at: require(body, 'evening_at'),
        evening_enabled: require(body, 'evening_enabled'),
        // notify 可选，不给即不改
        ...(body.notify === undefined ? {} : { notify: body.notify }),
        ...(body.language === undefined ? {} : { language: body.language }),
      }
      for (const k of ['morning_at', 'evening_at'])
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next[k])) throw new HttpError(422, `${k} 不是 HH:MM`)
      Object.assign(settings, next)
      return settings
    },
  ],
  [
    'POST',
    /^\/calendar\/([^/]+)\/delete$/,
    (m, q, body) => {
      const uid = decodeURIComponent(m[1])
      const start = require(body, 'start')
      const ev = mockEvents().find((e) => e.uid === uid && e.start === start)
      if (ev === undefined) throw new HttpError(404, `日程 ${uid} @ ${start} 不存在`)
      if (ev.read_only) throw new HttpError(409, '这是订阅来的日历，只能在原日历里改')
      const job = newJob('calendar_delete', 'server', null)
      job.payload = { uid, start }
      return job
    },
  ],
  ['GET', /^\/subscriptions$/, () => ({ subscriptions })],
  [
    'POST',
    /^\/subscriptions\/([^/]+)\/run$/,
    (m) => {
      // "现在跑"（design.md 8.7）：同类任务已在排队 / 在跑时返回那一个
      const kind = `feed_${findSubscription(m[1]).kind}`
      const existing = jobs.find((j) => j.kind === kind && (j.status === 'queued' || j.status === 'running'))
      return existing === undefined ? newJob(kind, 'mac', null) : existing
    },
  ],
  [
    'POST',
    /^\/subscriptions\/([^/]+)\/enabled$/,
    (m, q, body) => {
      const sub = findSubscription(m[1])
      const enabled = require(body, 'enabled')
      if (typeof enabled !== 'boolean') throw new HttpError(422, 'enabled 要是 true / false')
      const before = { enabled: sub.enabled }
      sub.enabled = enabled
      addRecord({
        author: 'me',
        source: 'app',
        kind: 'log',
        tier: 'log',
        item_id: null,
        title: `订阅「${sub.name}」${enabled ? '打开' : '关掉'}了`,
        body: '',
        undo: { type: 'subscription', subscription_id: sub.id, before },
      })
      return sub
    },
  ],
  [
    'GET',
    /^\/calendar$/,
    (m, q) => {
      if (!q.has('from') || !q.has('to')) throw new HttpError(422, '缺参数 from/to')
      const [from, to] = [q.get('from'), q.get('to')]
      return { events: mockEvents().filter((e) => tzYmd(new Date(e.start)) >= from && tzYmd(new Date(e.start)) <= to) }
    },
  ],
]

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  })
  res.end(payload === undefined ? '' : JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// 图片附件：内存里存字节和元数据；只收 JPEG、≤ 5 MB
const attachments = new Map()
const MAX_BYTES = 5 * 1024 * 1024

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(422, '不是 JPEG')
  let i = 2
  while (i < buf.length) {
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new HttpError(422, 'JPEG 里找不到尺寸')
}

async function uploadAttachment(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const form = await new Request('http://mock/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] },
    body: Buffer.concat(chunks),
  }).formData()
  const file = form.get('file')
  if (file === null || typeof file === 'string') throw new HttpError(422, '缺字段 file')
  if (file.type !== 'image/jpeg') throw new HttpError(422, `只收 image/jpeg，收到 ${file.type}`)
  const data = Buffer.from(await file.arrayBuffer())
  if (data.length > MAX_BYTES) throw new HttpError(422, '图片超过 5 MB')
  const meta = { id: newId('a'), content_type: 'image/jpeg', bytes: data.length, ...jpegSize(data), created_at: now() }
  attachments.set(meta.id, { meta, data, used: false })
  return meta
}

// 网页版（PWA）：/app/ 下提供 npm run build:pwa 的产物 dist-pwa，不要令牌，响应头和 hub 一样（docs/api.md "公开静态路径 /app/"）。
// iOS 模拟器 Safari 打开 http://localhost:<PORT>/app/ 就能走安装、布局和路由；推送收发只能在真机 https 下验
const WEB_DIR = join(here, '..', 'dist-pwa')
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

function serveWeb(url, res) {
  const headers = { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
  if (url.pathname === '/app') {
    res.writeHead(307, { ...headers, Location: '/app/' })
    return res.end()
  }
  if (!existsSync(WEB_DIR)) throw new Error(`没有 ${WEB_DIR}：先 MOJITO_WEB_BUILD=<12 位十六进制> npm run build:pwa`)
  const rel = decodeURIComponent(url.pathname.slice('/app/'.length))
  const file = normalize(join(WEB_DIR, rel))
  const inside = file === WEB_DIR || file.startsWith(WEB_DIR + sep)
  const found = inside && existsSync(file) && statSync(file).isFile()
  const last = rel.split('/').pop()
  // 文件不存在、最后一段没扩展名：交给客户端路由（index.html）；有扩展名或跑出目录：404
  const target = found ? file : inside && !last.includes('.') ? join(WEB_DIR, 'index.html') : null
  if (target === null) {
    res.writeHead(404, headers)
    return res.end()
  }
  const immutable = rel.startsWith('_expo/static/')
  res.writeHead(200, {
    ...headers,
    'Content-Type': TYPES[extname(target)],
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(readFileSync(target))
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204)
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/app' || url.pathname.startsWith('/app/'))) return serveWeb(url, res)
  try {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${TOKEN}`) {
      console.log('401 headers:', JSON.stringify(req.headers))
      throw new HttpError(401, '令牌不对')
    }
    // 附件是 multipart 上传和二进制下载，不走下面的 JSON 路由
    if (req.method === 'POST' && url.pathname === '/attachments') {
      const meta = await uploadAttachment(req)
      console.log('POST /attachments 200', meta.bytes, `${meta.width}x${meta.height}`)
      return send(res, 200, meta)
    }
    const att = url.pathname.match(/^\/attachments\/([^/]+)$/)
    if (req.method === 'GET' && att !== null && att[1] === MOCK_COVER) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' })
      return res.end(mockCoverData)
    }
    if (req.method === 'GET' && att !== null) {
      if (!attachments.has(att[1])) throw new HttpError(404, `attachment ${att[1]} 不存在`)
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' })
      return res.end(attachments.get(att[1]).data)
    }
    const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname))
    if (!route) throw new HttpError(404, `没有接口 ${req.method} ${url.pathname}`)
    const body = req.method === 'GET' ? {} : await readBody(req)
    advanceAll()
    const payload = route[2](url.pathname.match(route[1]), url.searchParams, body, req)
    const status = payload === undefined ? 204 : 200
    console.log(req.method, url.pathname + url.search, status)
    send(res, status, payload)
  } catch (err) {
    if (!(err instanceof HttpError)) throw err
    console.log(req.method, url.pathname + url.search, err.status, err.message)
    send(res, err.status, { detail: err.message })
  }
}).listen(PORT, () => console.log(`mojito mock on http://localhost:${PORT}  token=${TOKEN}`))

// sources 全部在线（README 截图用这份数据）：worker、服务器 agent、google-calendar、maintainer、nas-backup 每 10 秒"心跳"
const LIVE = ['worker', 'server-agent', 'google-calendar', 'maintainer', 'nas-backup']
const beat = () => LIVE.forEach((name) => (sources.find((s) => s.name === name).last_seen_at = now()))
setInterval(beat, 10000).unref()
beat()
