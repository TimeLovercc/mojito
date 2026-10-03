// 对应 docs/api.md 的数据对象与响应结构。datetime 一律 UTC ISO 字符串，date 是本地日历日。

export type Goal = { id: string; title: string; status: 'active' | 'done' | 'dropped' }

export type PlanStatus = 'draft' | 'active' | 'closed'
export type Plan = {
  id: string
  start: string
  end: string
  goal_ids: string[]
  item_ids: string[]
  status: PlanStatus
  created_at: string | null
  closed_at: string | null
  review_status: 'none' | 'draft' | 'done'
  // 修订版计划指向被修订的那一期；批准修订版不需要先复盘
  revises: string | null
}

export type ItemCategory = 'research' | 'life'
export type ItemStatus = 'active' | 'waiting_you' | 'scheduled' | 'standing' | 'done' | 'closed'
export type Progress = { value: number; target: number; unit: string }
export type Item = {
  id: string
  title: string
  category: ItemCategory
  status: ItemStatus
  forgotten: boolean
  next_step: string
  next_at: string | null
  owner: 'auto' | 'me' | 'auto_then_me'
  done_definition: string
  goal_id: string | null
  project_id: string | null
  progress: Progress | null
  updated_at: string
  updated_by: string
}

export type Tier = 'interrupt' | 'digest' | 'quiet' | 'log'
export type HubRecord = {
  id: string
  at: string
  author: 'system' | 'me'
  source: string
  kind: 'log' | 'note' | 'alert' | 'decision' | 'chat' | 'feedback'
  tier: Tier
  item_id: string | null
  title: string
  body: string
  evidence: string | null
  needs_processing: boolean
  // agent 写日历、hub 写字段改动等可撤销动作时带 undo；hub 在撤销后填 undone_at
  undo: RecordUndo | null
  undone_at: string | null
  project_id: string | null
  // 只有对话消息会有图片，其余为空列表
  attachments: Attachment[]
  card_id: string | null
  // 维护会话在对话里发的消息（source=maintainer）指向它所属的反馈
  feedback_id: string | null
  // 推送分类（design.md 8.6）；早上简报、晚间提问是 brief，不推送的记录为 null
  category: NotifyKind | null
}

// app 只认"由笔记记成事项"（item_create，笔记页的"撤销整理"要找它），其余类型只用来显示"撤销"
export type RecordUndo =
  | { type: 'item_create'; item_id: string }
  | { type: 'calendar' | 'item' | 'goal' | 'plan' | 'project' | 'settings' | 'note' | 'subscription' }

export type Attachment = { id: string; content_type: 'image/jpeg'; bytes: number; width: number; height: number; created_at: string }

export type Source = {
  name: string
  expected_interval_s: number
  last_seen_at: string | null
  alive: boolean
  // 结果健康（如 arXiv 当天 0 张卡片 → warn），数据源或 worker 代报；没报过为 null
  health: 'ok' | 'warn' | 'error' | null
  health_detail: string | null
  health_at: string | null
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export type Runner = 'server' | 'mac'
export type Job = {
  id: string
  kind:
    | 'refresh'
    | 'process_note'
    | 'draft_plan'
    | 'chat_reply'
    | 'morning_brief'
    | 'evening_prompt'
    | 'undo'
    | 'draft_review'
    | 'weekly_summary'
    | 'calendar_delete'
    | 'feed_papers'
    | 'feed_mail'
  runner: Runner
  record_id: string | null
  // calendar_delete 为 {uid}，其余多为 null
  payload: Record<string, unknown> | null
  status: JobStatus
  requested_at: string | null
  started_at: string | null
  finished_at: string | null
  error: string | null
}

// 今日重点里的事项多一个 days_until（今天 = 0），只在 /today 里有
export type FocusItem = Item & { days_until: number }

export type Today = {
  generated_at: string
  plan: Plan | null
  focus: FocusItem[]
  // 逾期：还在做、过了时间、7 天内有动静（琥珀）；被忘了（红）见 forgotten
  overdue: Item[]
  needs_you: { items: Item[]; plans: Plan[]; drafts: Draft[]; projects: Project[]; feedback: Feedback[] }
  forgotten: Item[]
  alerts: HubRecord[]
  schedule: CalEvent[]
}

// 日历事件（只读）。全天事件的 start 是本地当天 00:00
// read_only：订阅来的日历（如工作或学校的 Outlook），只读，不能删（api.md"订阅日历"）
export type CalEvent = { uid: string; start: string; end: string; all_day: boolean; title: string; location: string | null; read_only: boolean }

// 信息流的订阅（design.md 8.5、8.10）：app 只能开关；改时间、改关注什么在对话里说。
// brief：每日 AI 简报（没有 config）；watch：实验室动态（config.labs、config.every_hours）；mail：每日邮件。name 由 hub 按语言给
export type Subscription = {
  id: string
  name: string
  kind: 'brief' | 'watch' | 'mail'
  at: string
  enabled: boolean
  config: Record<string, unknown>
  last_run_at: string | null
  last_result: string | null
  health: 'ok' | 'warn' | 'error' | null
}
export type SubscriptionsList = { subscriptions: Subscription[] }

// notify：按类型开关推送（手机和 Mac 都按它过滤；关掉只是不推，记录照常进时间线，design.md 8.6）
export const NOTIFY_KINDS = ['brief', 'chat', 'alert', 'news', 'feedback', 'release', 'jobs'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]
export type Language = 'zh' | 'en'
// language：界面语言（design.md 8.9）；8.9 之前的 hub 不返回这个字段
export type Settings = {
  morning_at: string
  evening_at: string
  evening_enabled: boolean
  notify: Record<NotifyKind, boolean>
  language?: Language
}

export type PlanDetail = { plan: Plan; goals: Goal[]; items: Item[]; review: Review | null }

// 对外发送只起草：app 只能复制正文、标"我已发出"或"不要"，永远不替用户发送
export type Draft = {
  id: string
  at: string
  source: string
  channel: 'email' | 'message'
  to: string
  subject: string | null
  body: string
  item_id: string | null
  status: 'pending' | 'dismissed' | 'sent_by_me'
}

export type ProjectStatus = 'proposed' | 'active' | 'paused' | 'done' | 'declined'
export type Project = {
  id: string
  title: string
  area: 'research' | 'life'
  status: ProjectStatus
  repo_path: string | null
  goal_id: string | null
  summary: string | null
  summary_evidence: string | null
  summary_at: string | null
  // 以下三项 hub 计算
  last_activity_at: string | null
  stale: boolean
  open_items: number
  // 项目概况（api.md"项目概况"、design.md 8.11）；从没写过为 null
  overview: ProjectOverview | null
}

export type KillState = 'running' | 'queued' | 'not_started' | 'passed' | 'failed' | 'done'

// source：project 从项目会话自己维护的 overview.json 抄来；claude 刷新时 Claude 写；me 用户在对话里改。
// checked_at：project 为 overview.json 的 updated_at，其余为写入时间；
// status_file / status_changed 只对 project 有意义；*_path 是 Mac 上的绝对路径
export type ProjectOverview = {
  source: 'project' | 'claude' | 'me'
  one_liner: string | null
  status: string | null
  kill: { state: KillState; setting: string; progress: string } | null
  paper: {
    title: string | null
    format: string | null
    pending: number | null
    review: string | null
    advice: string | null
    note: string | null
    pdf_path: string | null
    review_path: string | null
    dir_path: string | null
  } | null
  // 评审卡片（api.md"项目概况"补充 16:50）：score 0–5；novelty 等可含 Markdown 链接；objections 每条一项
  score: number | null
  abstract: string | null
  novelty: string | null
  significance: string | null
  objections: string[] | null
  decision: string | null
  checked_at: string
  status_file: string | null
  status_changed: boolean
  evidence: string | null
}

// worker 从 Orca 只读采集的快照，每个项目只存最新一份
export type Snapshot = {
  taken_at: string
  worktrees: { name: string; branch: string; path: string; status: string; last_output: string; last_activity_at: string | null }[]
  commits: { repo: string; sha: string; subject: string; at: string }[]
}

export type ProjectsList = { projects: Project[] }
export type ProjectDetail = { project: Project; items: Item[]; snapshot: Snapshot | null; records: HubRecord[] }
export type ProjectAction = 'approve' | 'decline' | 'pause' | 'resume' | 'done'

export type AuthStatus = { name: string; ok: boolean; detail: string | null; checked_at: string }
export type AuthList = { auth: AuthStatus[] }

export type UsageEvent = { at: string; kind: 'view' | 'action'; name: string; detail: object | null }

// 信息流卡片：值得读的东西。design.md 8.10 起是报告：brief 每日 AI 简报、alert 新动态即时报，
// summary 是 3 行要点，body 是 Markdown 全文；旧的 paper / post 等卡片照常显示（body 为 null）
export type Card = {
  id: string
  at: string
  source: string
  origin: string
  // mail：每日邮件（summary 每封一行，带 [打开](Gmail 链接)）；post：帖子类内容（有封面，来自自己加的数据源）
  kind: 'brief' | 'alert' | 'paper' | 'idea' | 'report' | 'other' | 'mail' | 'post'
  project_id: string | null
  title: string
  summary: string
  body: string | null
  link: string | null
  dedupe_key: string
  status: 'new' | 'saved' | 'dismissed'
  item_id: string | null
  // 帖子封面（附件 id），其余为 null
  image_attachment_id: string | null
}
export type CardsPage = { cards: Card[]; last_read_id: string | null }

// 用户反馈（系统页"更多 → 反馈与建议"）；维护会话分诊、修复，需要确认的进"等你拍板"
export type FeedbackContext = { screen: string | null; item_id: string | null; project_id: string | null; app_update_id: string | null }
export type Feedback = {
  id: string
  at: string
  body: string
  attachments: Attachment[]
  context: FeedbackContext
  status: 'open' | 'triaged' | 'fixing' | 'awaiting_approval' | 'shipped' | 'declined'
  ship_mode: 'auto' | 'ask' | null
  summary: string | null
  updated_at: string
}
export type FeedbackList = { feedback: Feedback[] }
// 反馈的讨论：我和维护会话来回说
export type FeedbackMessage = {
  id: string
  feedback_id: string
  at: string
  author: 'me' | 'maintainer'
  body: string
  attachments: Attachment[]
}
export type FeedbackMessages = { messages: FeedbackMessage[] }

// 口味笔记：对话里说过的论文偏好，worker 挑论文时参考
export type TasteNote = { id: string; at: string; text: string; source: string }
export type TasteNotes = { notes: TasteNote[] }

// 检验指标：每天打开次数、晚间提问与回复
export type MetricsDay = { date: string; opens: number; evening_asked: number; evening_replied: number }
export type Metrics = { days: MetricsDay[]; totals: { opens: number; evening_asked: number; evening_replied: number } }

export type Review = {
  plan_id: string
  created_at: string
  summary: string
  completed_item_ids: string[]
  missed_item_ids: string[]
  patterns: string[]
  user_note: string | null
  status: 'draft' | 'done'
}
export type ItemDetail = { item: Item; records: HubRecord[] }
export type RecordsPage = { records: HubRecord[]; last_read_id: string | null }
export type ItemsList = { items: Item[] }
export type PlansList = { plans: Plan[] }
export type GoalsList = { goals: Goal[] }
export type SourcesList = { sources: Source[] }
export type JobsList = { jobs: Job[] }
export type ChatPage = { records: HubRecord[] }
export type ChatOut = { record: HubRecord; job: Job }

// 请求体全部字段必填，可为 null 的显式传 null（docs/api.md "请求体"）
// project_id 目前总是 null（带 item_id 时 hub 用事项的 project_id）；项目面板上线后才由界面选择
// attachment_ids：笔记带的图片（先 POST /attachments，最多 4 张，design.md 8.6）；只发图时 body 为空、title 写"[图片]"
export type NewRecord = {
  title: string
  body: string
  item_id: string | null
  project_id: string | null
  needs_processing: boolean
  attachment_ids: string[]
}
export type Decision =
  | { action: 'approve' }
  | { action: 'decline' }
  | { action: 'postpone'; until: string }
  | { action: 'done' }
  | { action: 'close' }
  | { action: 'reopen' }
