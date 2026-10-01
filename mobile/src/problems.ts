import type { AuthList, Runner, SourcesList } from './api/types'
import { t } from './i18n'

// 系统有没有问题：系统页顶部状态行、侧栏的系统点、菜单栏页脚共用一套判断（docs/desktop-v2.md）

// 两个 agent 的心跳来自数据源 server-agent / worker，不在"数据源"列表里重复显示
export const AGENTS: { runner: Runner; source: string; name: string; note: string }[] = [
  { runner: 'server', source: 'server-agent', name: t('轻量 agent'), note: t('服务器 · 一次一个任务') },
  { runner: 'mac', source: 'worker', name: 'Mac agent', note: t('Mac · 睡着时任务排队') },
]
// 维护会话每 15 分钟报心跳（数据源 maintainer），也在"运行"里显示，不在数据源列表重复
export const MAINTAINER = 'maintainer'
export const AGENT_SOURCES = new Set([...AGENTS.map((a) => a.source), MAINTAINER])

export const AUTH_LABEL: Record<string, string> = {
  'google-calendar-write': t('Google 日历（写）'),
  'gmail-read': t('Gmail（只读）'),
  'claude-server': t('Claude（服务器）'),
  'claude-mac': t('Claude（Mac）'),
  x: 'X',
}

export type Problem = { text: string; bad: boolean }

// 汇总所有要人留意的：hub 连不上、agent / 维护会话失联、数据源没心跳或结果不对、授权失效
export function problemsOf(configured: boolean, hubError: boolean, sources: SourcesList | null, auth: AuthList | null): Problem[] | null {
  if (!configured) return [{ text: t('还没填 hub 地址和令牌（在"更多"里）'), bad: true }]
  if (hubError) return [{ text: t('Hub 连不上'), bad: true }]
  if (sources === null || auth === null) return null
  const out: Problem[] = []
  const find = (name: string) => sources.sources.find((x) => x.name === name)
  for (const a of AGENTS) {
    const src = find(a.source)
    if (src === undefined) out.push({ text: t('{name}未登记', { name: a.name }), bad: true })
    else if (!src.alive) out.push({ text: t('{name}失联', { name: a.name }), bad: true })
  }
  const m = find(MAINTAINER)
  if (m === undefined) out.push({ text: t('维护会话没报过心跳'), bad: true })
  else if (!m.alive) out.push({ text: t('维护会话失联'), bad: true })
  for (const src of sources.sources.filter((x) => !AGENT_SOURCES.has(x.name))) {
    if (!src.alive) out.push({ text: t('{name} 没心跳', { name: src.name }), bad: true })
    else if (src.health === 'error') out.push({ text: t('{name} 出错', { name: src.name }), bad: true })
    else if (src.health === 'warn') out.push({ text: t('{name} 需要留意', { name: src.name }), bad: false })
  }
  for (const x of auth.auth.filter((y) => !y.ok)) {
    out.push({ text: t('{name} 授权失效', { name: x.name in AUTH_LABEL ? AUTH_LABEL[x.name] : x.name }), bad: true })
  }
  return out
}
