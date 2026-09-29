import type { HubRecord, Item, JobStatus, Plan } from './api/types'
import { t } from './i18n'
import { colors } from './theme'

export type Tone = 'g' | 'a' | 'r' | 'n'

// 事项状态 → 标签文字和颜色（状态色只用绿 / 琥珀 / 红）
export const itemStatus: Record<Item['status'], { label: string; tone: Tone }> = {
  active: { label: t('进行中'), tone: 'g' },
  waiting_you: { label: t('等你'), tone: 'a' },
  scheduled: { label: t('已排期'), tone: 'n' },
  standing: { label: t('长期'), tone: 'n' },
  done: { label: t('完成'), tone: 'g' },
  closed: { label: t('关闭'), tone: 'n' },
}

export const planStatus: Record<Plan['status'], { label: string; tone: Tone }> = {
  draft: { label: t('草稿'), tone: 'a' },
  active: { label: t('进行中'), tone: 'g' },
  closed: { label: t('已结束'), tone: 'n' },
}

export const projectStatus: Record<'proposed' | 'active' | 'paused' | 'done' | 'declined', { label: string; tone: Tone }> = {
  proposed: { label: t('待确认'), tone: 'a' },
  active: { label: t('进行中'), tone: 'g' },
  paused: { label: t('暂停'), tone: 'n' },
  done: { label: t('完成'), tone: 'g' },
  declined: { label: t('不要了'), tone: 'n' },
}

export const feedbackStatus: Record<
  'open' | 'triaged' | 'fixing' | 'awaiting_approval' | 'shipped' | 'declined',
  { label: string; tone: Tone }
> = {
  open: { label: t('已收到'), tone: 'n' },
  triaged: { label: t('已看过'), tone: 'n' },
  fixing: { label: t('修复中'), tone: 'a' },
  awaiting_approval: { label: t('等你确认'), tone: 'a' },
  shipped: { label: t('已修复'), tone: 'g' },
  declined: { label: t('没改'), tone: 'n' },
}

// 使用记录里的页面名（反馈的 context.screen）对应的中文；不认识的原样显示
const SCREEN_NAMES: Record<string, string> = {
  today: t('今天'),
  plan_current: t('计划'),
  plan_history: t('计划历史'),
  plan_detail: t('计划详情'),
  projects: t('项目'),
  project_detail: t('项目详情'),
  items: t('全部事项'),
  item_detail: t('事项详情'),
  feed: t('信息流'),
  card_detail: t('卡片详情'),
  notes: t('笔记'),
  timeline: t('全部动态'),
  system: t('系统'),
}
export function screenName(screen: string): string {
  return screen in SCREEN_NAMES ? SCREEN_NAMES[screen] : screen
}

// 研究 / 生活只用文字区分，不再用分类色（design.md 8.2）
export const category: Record<Item['category'], { label: string }> = {
  research: { label: t('研究') },
  life: { label: t('生活') },
}

export const owner: Record<Item['owner'], string> = { auto: t('自动'), me: t('我'), auto_then_me: t('先自动后我') }

export const recordKind: Record<HubRecord['kind'], string> = {
  log: t('日志'),
  note: t('笔记'),
  alert: t('告警'),
  decision: t('拍板'),
  chat: t('对话'),
  feedback: t('反馈'),
}

// 来源名（Record.source、Item.updated_by、Card.source）显示成中文；不认识的原样显示
const SOURCE_NAMES: Record<string, string> = {
  app: t('你'),
  'server-agent': 'Mojito',
  worker: 'Mac agent',
  hub: t('系统'),
  seed: t('初始数据'),
  maintainer: t('维护会话'),
}
export function sourceName(source: string): string {
  return source in SOURCE_NAMES ? SOURCE_NAMES[source] : source
}

// 记录正文里 hub / worker 写出的字段名和枚举值（如"status 从 active 改成 done"）对应的中文
export const FIELD_NAMES: Record<string, string> = {
  status: t('状态'),
  owner: t('谁做'),
  category: t('类别'),
  next_at: t('时间'),
  next_step: t('下一步'),
  title: t('标题'),
  project_id: t('项目'),
  done_definition: t('完成标准'),
}
export const ENUM_NAMES: Record<string, string> = {
  active: t('进行中'),
  waiting_you: t('等你'),
  scheduled: t('已排期'),
  standing: t('长期'),
  done: t('完成'),
  closed: t('关闭'),
  me: t('我'),
  auto: t('自动'),
  auto_then_me: t('先自动后我'),
  research: t('研究'),
  life: t('生活'),
}

export const jobStatus: Record<JobStatus, string> = { queued: t('已排队'), running: t('工人处理中'), done: t('更新好了'), failed: t('刷新失败') }
