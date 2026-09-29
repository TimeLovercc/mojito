import type { Item, Today } from '../../src/api/types'
import { shortDate } from '../../src/time'
import { t } from '../../src/i18n'

// "等你拍板"（/today.needs_you）的件数和每件一行的说明，顺序与 app 今天页一致
export function decideCount(today: Today): number {
  const n = today.needs_you
  return n.plans.length + n.items.length + n.drafts.length + n.feedback.length + n.projects.length
}

export function decideLines(today: Today): { key: string; text: string }[] {
  const n = today.needs_you
  return [
    ...n.plans.map((p) => ({
      key: `plan-${p.id}`,
      text: `${p.revises === null ? t('新一期计划草稿') : t('本期计划修订版')} ${shortDate(p.start)} – ${shortDate(p.end)}`,
    })),
    ...n.items.map((i) => ({ key: `item-${i.id}`, text: i.title })),
    ...n.drafts.map((d) => ({ key: `draft-${d.id}`, text: t('草稿：{subject}', { subject: d.subject === null ? d.to : d.subject }) })),
    ...n.feedback.map((f) => ({ key: `fb-${f.id}`, text: t('修复待确认：{summary}', { summary: f.summary === null ? f.body : f.summary }) })),
    ...n.projects.map((p) => ({ key: `proj-${p.id}`, text: t('发现新项目：{title}', { title: p.title }) })),
  ]
}

// 准绳落地（docs/api.md）：/today.focus 每条带 days_until，另有 overdue。src/api/types.ts 由 mobile 会话更新，widget 先在这里声明。
export type FocusItem = Item & { days_until: number }
export type TodayV3 = Omit<Today, 'focus'> & { focus: FocusItem[]; overdue: Item[] }

// 今日重点里今天之后的那件标"还有 N 天"
export function focusText(item: FocusItem): string {
  return item.days_until === 0 ? item.title : t(item.days_until === 1 ? '{title} · 还有 1 天' : '{title} · 还有 {n} 天', { title: item.title, n: item.days_until })
}
