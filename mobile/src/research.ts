import type { ChatLink, MapOrigin, Project, ResearchMap, RunState, Stage } from './api/types'
import { t, tc } from './i18n'
import { tauri } from './tauri'
import { colors, isDark } from './theme'
import { when } from './time'
import type { HubView } from './use-hub'

// 研究地图（design.md 8.13、api.md"研究地图"）：项目页的共用部分，Mac 的导图和手机的折叠树都用

// 运行状态方块：▶ 进行中、❚❚ 暂停、■ 已停、✓ 已完成；研究项目还没有新卡片时是 ? 待核对
export type RunShown = RunState | 'unknown'
export const RUN: Record<RunShown, { label: string; glyph: string; color: string }> = {
  running: { label: tc('运行状态', '进行中'), glyph: '▶', color: colors.ok },
  paused: { label: tc('运行状态', '暂停'), glyph: '❚❚', color: colors.warn },
  stopped: { label: tc('运行状态', '已停'), glyph: '■', color: colors.bad },
  done: { label: tc('运行状态', '已完成'), glyph: '✓', color: colors.brand },
  unknown: { label: tc('运行状态', '待核对'), glyph: '?', color: colors.tx3 },
}

export const STAGES: Stage[] = ['question', 'discovery', 'instrument', 'confirm', 'write']
export const STAGE: Record<Stage, string> = {
  question: tc('阶段', '立题'),
  discovery: tc('阶段', '看现象'),
  instrument: tc('阶段', '造仪器'),
  confirm: tc('阶段', '确认'),
  write: tc('阶段', '成文'),
}

// 每个方向一种颜色（和演示页同一组），按方向在地图里的顺序轮换
const BRANCH = isDark
  ? ['#5cc0cf', '#a993ef', '#79aef0', '#ec8ab8', '#9aa6b1']
  : ['#23798a', '#6b52b8', '#2a68b4', '#b0457a', '#6f7a84']
export const branchColor = (i: number): string => BRANCH[i % BRANCH.length]

// 生活项目没有研究卡片，方块按 hub 的项目状态；研究项目没有卡片时待核对
const LIFE_RUN: Record<Project['status'], RunShown> = {
  proposed: 'unknown',
  active: 'running',
  paused: 'paused',
  done: 'done',
  declined: 'stopped',
}
export function runOf(p: Project, life: boolean): RunShown {
  if (p.overview !== null && p.overview.card !== null) return p.overview.card.run_state
  return life ? LIFE_RUN[p.status] : 'unknown'
}

export const decisionsOf = (p: Project): number =>
  p.overview === null || p.overview.card === null ? 0 : p.overview.card.decisions.length

// 一个位置（起点、叶子或没有叶子的方向）的全名，如"做 app › 烘焙 › 烤坏了要知道为什么"
export function placeName(map: ResearchMap, id: string): string {
  for (const a of map.areas) {
    if (a.id === id) return a.name
    for (const l of a.children) {
      if (l.id === id) return `${a.name} › ${l.name}`
      for (const o of l.origins) if (o.id === id) return `${a.name} › ${l.name} › ${o.label}`
    }
  }
  throw new Error(`研究地图里没有位置 ${id}`)
}

// 一个方向里项目能挂的所有位置：没有叶子时是方向本身，否则是各叶子和叶子下的起点
export function placesOf(a: ResearchMap['areas'][number]): string[] {
  if (a.children.length === 0) return [a.id]
  return a.children.flatMap((l) => [l.id, ...l.origins.map((o) => o.id)])
}

// 起点对应的总原则短标签，如"记过程，不只记结果、先小、先离线"；空列表返回 null
export function originPrinciples(map: ResearchMap, o: MapOrigin): string | null {
  if (o.principles.length === 0) return null
  return o.principles
    .map((id) => {
      const p = map.principles.find((x) => x.id === id)
      if (p === undefined) throw new Error(`起点 ${o.id} 引用了不存在的总原则 ${id}`)
      return p.label
    })
    .join('、')
}

export const LIFE = 'life'

// 句末补句号（卡片里的字段都是完整的句子）
export const end = (s: string): string => (/[。！？.!?]$/.test(s) ? s : `${s}。`)

// Claude 按钮：Mac 上 claude://claude.ai/<路径> 让 Claude 应用直接打开那个对话；手机上 https 链接由系统交给装好的 Claude 应用。
// ChatGPT 对话没有应用链接（ChatGPT.app 只认 Codex 会话），两边都开网页
export function chatHref(app: 'claude' | 'chatgpt', chat: ChatLink): string {
  if (app === 'claude' && tauri !== null) return chat.url.replace(/^https:\/\/claude\.ai\//, 'claude://claude.ai/')
  return chat.url
}

// "复制全部"：整张卡片的纯文本，贴进对话或笔记用
export function cardText(p: Project, place: string, life: boolean): string {
  const o = p.overview
  const lines = [`# ${p.title}`]
  const card = o === null ? null : o.card
  const run = RUN[runOf(p, life)].label
  lines.push(card === null ? `${run} · ${place}` : `${run} · ${t('第 {n} 步「{stage}」', { n: STAGES.indexOf(card.stage) + 1, stage: STAGE[card.stage] })} · ${place}`)
  if (p.repo_path !== null) lines.push(t('目录：{path}', { path: p.repo_path }))
  lines.push('')
  if (o === null) return [...lines, t('还没有卡片')].join('\n')
  if (life) return [...lines, `${t('状态')}：${o.status === null ? t('没有') : end(o.status)}`].join('\n')
  lines.push(`## ${t('最新状态（{at}）', { at: when(o.checked_at) })}`)
  if (o.one_liner !== null) lines.push(`${t('核心想法')}：${end(o.one_liner)}`)
  if (card !== null && card.main_exp !== null) lines.push(`${t('主实验')}：${end(card.main_exp)}`)
  if (card !== null && card.contribution !== null) lines.push(`${t('贡献')}：${end(card.contribution)}`)
  if (o.status !== null) lines.push(`${t('状态')}：${end(o.status)}`)
  if (o.paper !== null) lines.push(`${t('论文')}：${paperLine(o.paper)}`)
  if (card !== null && card.comment !== null) lines.push(`${t('评论')}：${end(card.comment)}`)
  if (card !== null && card.decisions.length > 0) lines.push(`${t('待你决定')}：`, ...card.decisions.map((d) => `- ${d}`))
  if (card !== null && card.development.length > 0) {
    lines.push('', `## ${t('项目发展')}`)
    for (const s of card.development) lines.push(`${s.title}：${s.text.replace(/\*\*(.+?)\*\*/g, '$1')}`, '')
  }
  if (card !== null && card.history.length > 0) {
    lines.push('', `## ${t('状态历史')}`)
    for (const h of card.history) lines.push(`- ${when(h.at)} ${h.change}`)
  }
  return lines.join('\n')
}

type Paper = NonNullable<NonNullable<Project['overview']>['paper']>
export function paperLine(p: Paper): string {
  const parts = [p.title, p.format, p.pending === null ? null : t('{n} 处 pending', { n: p.pending })].filter((x): x is string => x !== null)
  const pdf = p.pdf_path === null ? '' : ` PDF：${p.pdf_path}`
  return `${parts.join('；')}${p.note === null ? '' : `。${end(p.note)}`}${pdf}`
}

// 地图页同时要地图和三份项目列表（进行中 / 暂停在 /projects，已完成要单独取）；合成一个 HubView 给 Screen 用
export function both<A, B>(a: HubView<A>, b: HubView<B>): HubView<{ a: A; b: B }> {
  return {
    data: a.data === null || b.data === null ? null : { a: a.data, b: b.data },
    fetchedAt: a.fetchedAt === null || b.fetchedAt === null ? null : a.fetchedAt < b.fetchedAt ? a.fetchedAt : b.fetchedAt,
    live: a.live && b.live,
    error: a.error === null ? b.error : a.error,
    syncing: a.syncing || b.syncing,
    pulling: a.pulling || b.pulling,
    pull: () => Promise.all([a.pull(), b.pull()]).then(() => undefined),
    refresh: () => Promise.all([a.refresh(), b.refresh()]).then(() => undefined),
  }
}

// 地图上的项目：hub 里找不到的 id（比如项目被标成"不要"）单独列出，不悄悄丢掉
export type Placed = { project: Project; area: string; chats: ResearchMap['projects'][number]['chats'] }
export function placeProjects(map: ResearchMap, projects: Project[]): { placed: Placed[]; missing: string[] } {
  const byId = new Map(projects.map((p) => [p.id, p]))
  const placed: Placed[] = []
  const missing: string[] = []
  for (const m of map.projects) {
    const p = byId.get(m.id)
    if (p === undefined) missing.push(m.id)
    else placed.push({ project: p, area: m.area, chats: m.chats })
  }
  return { placed, missing }
}
