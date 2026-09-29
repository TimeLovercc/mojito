import type { HubConfig } from '../config/store'
import { t } from '../i18n'
import type {
  Card,
  ChatOut,
  Decision,
  Feedback,
  FeedbackContext,
  FeedbackMessage,
  TasteNote,
  Draft,
  HubRecord,
  Item,
  Job,
  NewRecord,
  Plan,
  Project,
  ProjectAction,
  Review,
  Settings,
  Subscription,
  UsageEvent,
} from './types'

export class HubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`${status} ${path}：${detail}`)
  }
}

// app 自己写的人话报错（连不上 hub、没有相机权限等）：humanize 原样显示，不用"出错了"
export class ReadableError extends Error {}

const TIMEOUT_MS = 20000

export async function hubRequest<T>(config: HubConfig, method: 'GET' | 'POST' | 'PUT', path: string, body?: object): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const url = config.hubUrl.replace(/\/+$/, '') + path
  // 超时就中止：挂住的请求会让这个路径一直处于"同步中"，之后的同步全被跳过，页面停在旧数据
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal }
  try {
    // fetch 只在连不上或被中止时抛错；加上中文说明后照样抛出
    const res = await fetch(url, init).catch((err: Error) => {
      throw new ReadableError(
        abort.signal.aborted ? t('hub {n} 秒没响应', { n: TIMEOUT_MS / 1000 }) : t('连不上 hub（{error}）', { error: err.message }),
      )
    })
    const text = await res.text()
    if (!res.ok) throw new HubError(res.status, path, text)
    return (text === '' ? null : JSON.parse(text)) as T
  } finally {
    clearTimeout(timer)
  }
}

// 动作接口，返回值按 docs/api.md "写操作的返回"。页面在动作成功后重新 GET。
export const actions = {
  addRecord: (c: HubConfig, r: NewRecord) => hubRequest<HubRecord>(c, 'POST', '/records', r),
  decide: (c: HubConfig, itemId: string, d: Decision) => hubRequest<Item>(c, 'POST', `/items/${encodeURIComponent(itemId)}/decision`, d),
  approvePlan: (c: HubConfig, planId: string) => hubRequest<Plan>(c, 'POST', `/plans/${encodeURIComponent(planId)}/approve`),
  markRead: (c: HubConfig, recordId: string) => hubRequest<null>(c, 'POST', '/reads', { record_id: recordId }),
  requestRefresh: (c: HubConfig) => hubRequest<Job>(c, 'POST', '/jobs', { kind: 'refresh' }),
  requestReview: (c: HubConfig) => hubRequest<Job>(c, 'POST', '/jobs', { kind: 'draft_review' }),
  // 删除笔记：只隐藏，记录不删（docs/api.md"简化"）
  hideRecord: (c: HubConfig, recordId: string) => hubRequest<HubRecord>(c, 'POST', `/records/${encodeURIComponent(recordId)}/hide`),
  undo: (c: HubConfig, recordId: string) => hubRequest<Job>(c, 'POST', `/records/${encodeURIComponent(recordId)}/undo`),
  resolveDraft: (c: HubConfig, draftId: string, status: 'dismissed' | 'sent_by_me') =>
    hubRequest<Draft>(c, 'POST', `/drafts/${encodeURIComponent(draftId)}/resolve`, { status }),
  finishReview: (c: HubConfig, planId: string, userNote: string) =>
    hubRequest<Review>(c, 'POST', `/reviews/${encodeURIComponent(planId)}/finish`, { user_note: userNote }),
  // project_id 必填可 null；带 item_id 时 hub 取事项的 project_id
  // attachment_ids 必填可为空列表（先 POST /attachments 拿到 id）；body 可为空串，但那时必须有图。
  // card_id 必填可 null：从信息流卡片"问问这个"进来时带上
  sendChat: (c: HubConfig, body: string, itemId: string | null, projectId: string | null, attachmentIds: string[], cardId: string | null) =>
    hubRequest<ChatOut>(c, 'POST', '/chat', {
      body,
      item_id: itemId,
      project_id: projectId,
      attachment_ids: attachmentIds,
      card_id: cardId,
    }),
  decideProject: (c: HubConfig, projectId: string, action: ProjectAction) =>
    hubRequest<Project>(c, 'POST', `/projects/${encodeURIComponent(projectId)}/decision`, { action }),
  postUsage: (c: HubConfig, events: UsageEvent[]) => hubRequest<null>(c, 'POST', '/usage', { events }),
  markCardRead: (c: HubConfig, cardId: string) => hubRequest<null>(c, 'POST', '/card-reads', { card_id: cardId }),
  sendFeedback: (c: HubConfig, body: string, attachmentIds: string[], context: FeedbackContext) =>
    hubRequest<Feedback>(c, 'POST', '/feedback', { body, attachment_ids: attachmentIds, context }),
  replyFeedback: (c: HubConfig, id: string, body: string, attachmentIds: string[]) =>
    hubRequest<FeedbackMessage>(c, 'POST', `/feedback/${encodeURIComponent(id)}/messages`, { body, attachment_ids: attachmentIds }),
  retireTaste: (c: HubConfig, id: string) => hubRequest<TasteNote>(c, 'POST', `/taste/${encodeURIComponent(id)}/retire`),
  decideFeedback: (c: HubConfig, id: string, action: 'approve' | 'decline') =>
    hubRequest<Feedback>(c, 'POST', `/feedback/${encodeURIComponent(id)}/decision`, { action }),
  putSettings: (c: HubConfig, s: Settings) => hubRequest<Settings>(c, 'PUT', '/settings', s),
  // 删日程：任何日程都能删，服务器 agent 执行并写可撤销的记录（design.md 8.5）。
  // start 必填：重复日程只删这一次（agent 按 uid + start 找实例）
  deleteEvent: (c: HubConfig, uid: string, start: string) =>
    hubRequest<Job>(c, 'POST', `/calendar/${encodeURIComponent(uid)}/delete`, { start }),
  setSubscriptionEnabled: (c: HubConfig, id: string, enabled: boolean) =>
    hubRequest<Subscription>(c, 'POST', `/subscriptions/${encodeURIComponent(id)}/enabled`, { enabled }),
  // 订阅页"现在跑"：入队这个订阅的抓取任务（同类任务已在排队 / 在跑时返回那一个，design.md 8.7）
  runSubscription: (c: HubConfig, id: string) => hubRequest<Job>(c, 'POST', `/subscriptions/${encodeURIComponent(id)}/run`),
  getJob: (c: HubConfig, jobId: string) => hubRequest<Job>(c, 'GET', `/jobs/${encodeURIComponent(jobId)}`),
}
