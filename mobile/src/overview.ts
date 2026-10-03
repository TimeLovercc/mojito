import type { ProjectOverview } from './api/types'
import { t } from './i18n'
import { tauri } from './tauri'
import { ago, when } from './time'

type Paper = NonNullable<ProjectOverview['paper']>

// 项目概况各块的标题，按详情里的顺序（api.md"项目概况"app 一节和补充 16:50）
export const OVERVIEW_LABELS = {
  one_liner: t('一句话'),
  status: t('状态'),
  kill: t('生死实验'),
  paper: t('论文'),
  abstract: t('摘要'),
  novelty: t('查新'),
  significance: t('意义与下一步'),
  objections: t('审稿质疑'),
  decision: t('决定'),
}

// 标题右侧的分数徽章（0–5，一位小数）
export function scoreText(score: number): string {
  return t('分数 {n}', { n: score.toFixed(1) })
}

// 论文胶囊：format、"N 处 pending"、"评审 <review>"、advice，缺的不显示
export function paperPills(p: Paper): string[] {
  const pills: (string | null)[] = [
    p.format,
    p.pending === null ? null : t('{n} 处 pending', { n: p.pending }),
    p.review === null ? null : t('评审 {review}', { review: p.review }),
    p.advice,
  ]
  return pills.filter((x): x is string => x !== null)
}

// 只有 note 的论文（没有论文目录）只显示 note
export function paperNoteOnly(p: Paper): boolean {
  return p.title === null && paperPills(p).length === 0
}

// 底部来源小字和琥珀胶囊（status_changed 时）：项目会话更新于 <本地时间>（STATUS 之后有改动）；
// Claude 整理 · 多久前；你改的 · 多久前
export function overviewSource(o: ProjectOverview): { text: string; changed: string | null } {
  if (o.source === 'project') {
    return { text: t('项目会话更新于 {at}', { at: when(o.checked_at) }), changed: o.status_changed ? t('STATUS 之后有改动') : null }
  }
  if (o.source === 'claude') return { text: t('Claude 整理 · {ago}', { ago: ago(o.checked_at) }), changed: null }
  return { text: t('你改的 · {ago}', { ago: ago(o.checked_at) }), changed: null }
}

// Mac app 里用系统默认程序打开本地路径（PDF、评审、论文文件夹）；desktop 外壳的 open_path 命令
export function openPath(path: string): Promise<void> {
  if (tauri === null) return Promise.reject(new Error(t('只有 Mac app 能打开本地文件')))
  return tauri.core.invoke<void>('open_path', { path }).catch((err: string) => {
    throw new Error(err)
  })
}
