> **English summary:** Mojito's API contract (written in Chinese): the only boundary between the hub, the server agent, the local worker, the maintainer session, the apps and external data sources — objects, endpoints, token roles, push, the PWA and runtime conventions. Change it only on the main branch; sections are appended in the order features were added, and later sections say explicitly what they replace.

# Mojito API 约定

hub 与 mobile / desktop / 网页版 / agent / worker / 维护会话 / 数据源之间唯一的边界。只在主分支修改。本文按功能加入的先后分节追加；后面的节可以修订前面的节，会写明"取代"。

- 基址：`https://<hub 地址>`（hub 监听 `127.0.0.1:8787`，由 HTTPS 入口暴露，例如 `tailscale serve`、Tailscale funnel、Cloudflare Tunnel 或反向代理）。
- 认证：`Authorization: Bearer <token>`。令牌类型决定能调用哪组接口。
- 时间：一律 ISO-8601 带时区。
- **配置时区**：hub、agent、worker 的环境变量 `MOJITO_TIMEZONE`（IANA 时区名，如 `Europe/Berlin` 或 `UTC`），三处都必填且必须相同。下文凡是"今天""每天 HH:MM""按日期"都按配置时区算；客户端显示时间用的时区也必须是它。
- 缺字段就报错（422），hub 不填默认值。
- 令牌存在 hub 的令牌文件里（格式由 hub 定，部署时生成），每个令牌对应一个角色：`app`、`worker`、`source:<name>`（后文追加 `agent`、`maintainer`）。角色不对返回 403，令牌不存在返回 401。
- 列表接口返回对象（如 `{"items": [...]}`），不直接返回数组。

## 数据对象

### Goal
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `title` | str | |
| `status` | `active` \| `done` \| `dropped` | |

### Plan
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `start`, `end` | date | 两周 |
| `goal_ids` | list[str] | |
| `item_ids` | list[str] | 这期要推进的事项 |
| `status` | `draft` \| `active` \| `closed` | Claude 起草为 `draft`，用户确认后 `active`；到期后置 `closed` |
| `created_at`, `closed_at` | datetime \| null | |

计划**永不删除**。同一时间最多一个 `active`。新计划转 `active` 时，旧的 `active` 置 `closed`；`end` 已过的 `active` 计划由 hub 在启动和每次看门狗巡检时置 `closed`。

### Item
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `title` | str | |
| `category` | `research` \| `life` | 工作 / 研究，或生活 |
| `status` | `active` \| `waiting_you` \| `scheduled` \| `standing` \| `done` \| `closed` | |
| `forgotten` | bool | **hub 计算，只读**（规则见后文"准绳落地"，取代这里最初的 48 小时规则） |
| `next_step` | str | |
| `next_at` | datetime \| null | |
| `owner` | `auto` \| `me` \| `auto_then_me` | |
| `done_definition` | str | 创建时写定 |
| `goal_id` | str \| null | |
| `progress` | object \| null | 由证据计算，如 `{"value": 4, "target": 10, "unit": "位朋友"}` |
| `updated_at` | datetime | |
| `updated_by` | str | 来源名 |

### Record
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `at` | datetime | |
| `author` | `system` \| `me` | |
| `source` | str | 如 `build-probe`、`orca-hook`、`worker`、`app` |
| `kind` | `log` \| `note` \| `alert` \| `decision` | 后文追加 `chat`、`feedback` |
| `tier` | `interrupt` \| `digest` \| `log` | 后文追加 `quiet` |
| `item_id` | str \| null | |
| `title` | str | |
| `body` | str | |
| `evidence` | str \| null | 链接或出处；Claude 推断的内容写 `inferred` |
| `needs_processing` | bool | 用户"请处理"的笔记 |

### Source
| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | str | |
| `expected_interval_s` | int | 超过则看门狗报警 |
| `last_seen_at` | datetime \| null | |
| `alive` | bool | hub 计算，只读 |

### Job
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `kind` | `refresh` \| `process_note` \| `draft_plan` | 后文追加更多 |
| `record_id` | str \| null | `process_note` 时为要处理的笔记，其余为 null |
| `status` | `queued` \| `running` \| `done` \| `failed` | |
| `requested_at`, `started_at`, `finished_at` | datetime \| null | |
| `error` | str \| null | |

## 接口

### app 令牌

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/today` | 今日重点 + `waiting_you` 事项 + 未读 `interrupt` 记录 |
| GET | `/goals` | |
| GET | `/plans/current` | 当前 active plan，含事项与进展；没有 active plan 返回 404 |
| GET | `/plans` | 计划历史：全部计划（含 `draft`、`closed`），按 `start` 倒序；只含 Plan 字段 |
| GET | `/plans/{id}` | 某一期计划详情，含目标、事项与进展（结构同 `/plans/current`） |
| GET | `/items?category=&status=&forgotten=` | |
| GET | `/items/{id}` | 事项 + 它的记录 |
| GET | `/records?before=&limit=` | 动态时间线（倒序）；`before` 为 record id，`limit` 必填 |
| GET | `/records/{id}` | 单条记录 → Record |
| POST | `/records` | 记一笔：`{title, body, item_id?, needs_processing}`；`needs_processing=true` 时自动入队 `process_note` |
| POST | `/items/{id}/decision` | `{action: "approve" \| "decline" \| "postpone", until?}`；写一条 `decision` 记录。见下方"拍板" |
| POST | `/plans/{id}/approve` | 草稿计划转 active |
| POST | `/jobs` | 刷新：`{kind: "refresh"}` → 返回 Job |
| GET | `/jobs/{id}` | 查任务状态 |
| GET | `/sources` | 系统页：各数据源心跳 |
| POST | `/devices` | 登记推送：`{fcm_token}` |
| POST | `/reads` | 标记动态已读位置：`{record_id}` |

### worker 令牌

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/worker/lease` | 领一个 `queued` 任务，置 `running`；没有任务返回 204 |
| POST | `/worker/jobs/{id}/finish` | `{status: "done" \| "failed", error?}` |
| PUT | `/items/{id}` | 创建或更新事项 |
| POST | `/plans` | 提交草稿计划 |

worker 也可以调用上面 app 组的全部 `GET` 接口，以及下面的数据源接口（`source` 记为 `worker`）。

### source 令牌

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/sources/{name}/heartbeat` | 心跳：`{expected_interval_s}`；首次心跳即登记该数据源，之后每次心跳可更新间隔。`{name}` 必须等于令牌里的 `source:<name>`（worker 令牌用 `worker`） |
| POST | `/events` | 写一条记录（`author` 固定为 `system`，`source` 取自令牌）；`tier=interrupt`/`digest` 时 hub 负责推送 |

## 请求体

全部字段必填；可为 null 的字段显式传 null。

```jsonc
// PUT /items/{id}（worker）—— id 取自路径，新事项 id 由 worker 生成（如 note-<record_id>）
{ "title", "category", "status", "next_step", "next_at", "owner", "done_definition", "goal_id", "progress" }
// forgotten、updated_at 由 hub 计算；updated_by 取令牌（worker 令牌记为 "worker"）。
// done_definition 创建时写定：更新已有事项时若与原值不同 → 409。

// POST /events（source / worker）
{ "kind", "tier", "item_id", "title", "body", "evidence" }
// at 取 hub 当前时间，author = system，source 取令牌，needs_processing = false。

// POST /records（app）
{ "title", "body", "item_id", "needs_processing" }
// at 取 hub 当前时间，author = me，source = app，kind = note，tier = log，evidence = null。

// POST /plans（worker）—— status 固定为 draft
{ "id", "start", "end", "goal_ids", "item_ids" }
```

写操作的返回：`POST /records`、`POST /events` → Record；`PUT /items/{id}`、`POST /items/{id}/decision` → Item；`POST /plans`、`POST /plans/{id}/approve` → Plan（approve 非 draft → 409）；`POST /devices`、`POST /reads` → 204。

`finish`：`status=failed` 时 `error` 必填，`done` 时不许带 `error`；非 `running` 任务 finish → 409。hub 自己写的记录（更新好了、任务失败、数据源失联）`source=hub`、`author=system`；失败和失联 `kind=alert`。

时间：hub 输出的 datetime 一律 UTC。按"天"判断的地方（计划 `end` 是否已过）用配置时区的日期。`alive` = `last_seen_at` 非空且距今 ≤ `expected_interval_s`；失联告警在下次心跳后复位。

## 响应结构

```jsonc
// GET /today
{
  "generated_at": "...",
  "plan": Plan | null,               // 当前 active plan
  "focus": [Item],                    // 今日重点（规则见后文"准绳落地"）
  "needs_you": {
    "items": [Item],                  // status = waiting_you 的全部事项（含 worker 整理出的草稿）
    "plans": [Plan]                   // status = draft 的计划
  },
  "forgotten": [Item],                // forgotten = true
  "alerts": [Record]                  // tier = interrupt 且晚于已读位置的记录
}

// GET /plans/current 和 GET /plans/{id}
{ "plan": Plan, "goals": [Goal], "items": [Item] }

// GET /items/{id}
{ "item": Item, "records": [Record] }   // 记录按 at 倒序

// GET /records
{ "records": [Record], "last_read_id": str | null }

// GET /goals  → {"goals": [...]}   GET /plans → {"plans": [...]}
// GET /items  → {"items": [...]}   GET /sources → {"sources": [...]}
// POST /jobs、GET /jobs/{id}、POST /worker/lease → Job
```

## 拍板

"需要你"（后来改名"等你拍板"）里的事项就是 `status = waiting_you` 的事项。worker 整理出的新事项草稿、种子数据里待确认的事项，都以 `waiting_you` 出现。

| action | 效果 |
|---|---|
| `approve` | `status` → `active` |
| `decline` | `status` → `closed` |
| `postpone` | `until` 必填；`next_at` → `until`，`status` 不变 |

每次拍板写一条 `kind=decision`、`author=me`、`source=app`、`tier=log` 的记录。草稿计划用 `POST /plans/{id}/approve` 确认。

## 任务

- `POST /records` 带 `needs_processing=true` → hub 入队 `{kind: "process_note", record_id}`。worker 读这条笔记，用 `PUT /items/{id}` 写一个 `status=waiting_you` 的事项草稿（`next_step`、`owner`、`done_definition` 都要写全），再用 `POST /events` 写一条挂在该事项上的 `log` 记录说明来源笔记，最后 finish。（后文"简化"一节修订了 process_note。）
- `refresh`：worker 查事实（脚本）、让 Claude 判断，更新事项的 `next_step` / `next_at` / `progress`，并写记录；推断内容 `evidence` 写 `inferred`。
- `POST /worker/jobs/{id}/finish` 时 hub 写一条记录：`refresh` 成功 → `tier=digest`、标题"更新好了"；任何任务失败 → `tier=digest`、标题含失败原因。所以刷新完成一定会推送到手机。
- 本机睡着时任务停在 `queued`，app 显示"已排队"。`running` 超过 30 分钟未 finish，看门狗把它置回 `queued`。

## 推送

hub 发出的推送只带分类、记录标题和 id（格式见后文"FCM 推送"和"Web Push"两节）。app 被唤醒后调用 `GET /items/{id}` 或 `GET /records` 取详情。`interrupt`、`digest` 推送，`log` 不推（后文追加 `quiet`）。没有登记任何设备时就不推，记录照写。

## 种子数据

`MOJITO_SEED` 指向的种子文件是第一批内容（目标、第一期计划、事项、说明记录、`settings`，以及后文追加的 `projects`、`item_projects`）。hub 启动时，若数据库里没有任何 Goal，则导入它；已有数据则不动。

- 仓库里的 `docs/seed.example.json` 是虚构的示例种子（用户 Sam 的内容，日期固定在生成那天，主要给假服务器用）；要一份以今天为准的示例种子，用 `examples/demo/demo_data.py seed` 现生成。你自己的真实种子放在仓库外或被忽略的目录，不入库。
- 示例数据只用虚构内容，不从真实 hub 或数据库导出后改写。

## 运行约定（hub / infra / worker / mobile 共用）

**hub**（`hub/` 是一个 uv 项目）
- 启动：在 `hub/` 下 `uv run uvicorn mojito_hub.main:app --host 127.0.0.1 --port 8787`。
- 环境变量全部必填，缺一个就启动失败。完整清单见文末"附：环境变量汇总"。最早的几个：
  - `MOJITO_DB`：SQLite 文件路径
  - `MOJITO_TOKENS`：令牌文件路径，JSON：`{"<token>": "app" | "worker" | "source:<name>" | ...}`
  - `MOJITO_SEED`：种子文件路径
  - `MOJITO_TIMEZONE`：配置时区
- hub 用 uv 管理的 Python 3.12（`.python-version`），和服务器系统自带的 Python 版本无关。
- `hub/deploy/` 归 infra 会话：systemd unit、安装/更新脚本、令牌生成。hub 会话不改这个目录。
- 参考部署布局：仓库 checkout 在 `/opt/mojito`，数据与令牌在 `/var/lib/mojito/`（`hub.db`、`tokens.json`、`env`），服务名 `mojito-hub`，服务用户 `mojito`。

**worker**（`worker/` 是一个 uv 项目）
- 配置在 `worker/.env`（不入库）或进程环境，缺一个就启动失败：`MOJITO_HUB_URL`、`MOJITO_WORKER_TOKEN`、`MOJITO_CLAUDE_BIN`（`command -v claude` 的绝对路径）、`MOJITO_TIMEZONE`，以及后文各节追加的几项（见文末汇总）。
- 判断用 `$MOJITO_CLAUDE_BIN -p`；macOS 上由 launchd 常驻（标签 `com.example.mojito.worker`，`KeepAlive`；标签前缀可以换成你自己的反向域名）。

**mobile**
- 基址和 app 令牌不打进包：首次启动在"系统"页输入，存 `expo-secure-store`。

---

# v2a 追加（对话、早晚通知、日历只读、agent 状态）

依据 design.md 第 9 节。v2a 只做：对话、早上简报、晚上提问、日历只读、系统页 agent 状态。写日历、撤销、两周复盘、本机读邮件等放 v2b。

## 令牌与执行者

- 新增令牌角色 `agent`：服务器 agent。可调用 app 组全部 `GET`、数据源接口（`source` 记为 `server-agent`）、`PUT /items/{id}`（只许写 `status=waiting_you` 的新事项；改已有事项 → 403；后文"对话里直接改事项"放开）、以及下方 agent/worker 共用接口。
- Job 新增字段 `runner`：`server` | `mac`（`server` = 和 hub 同机的服务器 agent，`mac` = 本机 worker）。`refresh`、`process_note`、`draft_plan` 固定 `mac`。
- `POST /worker/lease`：`worker` 令牌只领 `runner=mac`，`agent` 令牌只领 `runner=server`。领取顺序：`chat_reply` 优先，其余按 `requested_at` 先后。
- Job `kind` 新增：`chat_reply`（带 `record_id` = 用户那条消息）、`morning_brief`、`evening_prompt`（`record_id` 为 null）。

## 对话

对话消息就是 `kind=chat` 的 Record，和其他记录在同一条时间线里。

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| POST | `/chat` | app | `{body, item_id}`（`item_id` 可 null）→ 写 Record（`kind=chat`、`author=me`、`source=app`、`tier=log`、`title` 取正文前 40 字）并入队 `{kind: chat_reply, runner: server, record_id}`；返回 `{record, job}` |
| GET | `/chat?before=&limit=&item_id=` | app / agent / worker | `kind=chat` 的记录倒序；`limit` 必填；给 `item_id` 时只返回该事项下的对话 → `{records}` |
| POST | `/worker/jobs` | agent / worker | 创建任务 `{kind, runner, record_id}` → Job。服务器 agent 把需要本地登录态的请求转给本机用它（`kind=chat_reply, runner=mac`） |

agent 的回复用 `POST /events` 写：`kind=chat`，`source` 取令牌（`server-agent` 或 `worker`），`item_id` 同原消息。普通回复 `tier=digest`（推送）；转给本机时先回一条 `tier=log` 的"已转给 Mac，醒来后回你"。

## 早晚通知

- hub 按设置里的时间（配置时区）每天各入队一次 `morning_brief`、`evening_prompt`（`runner=server`）。只在到点后 10 分钟内入队，每天每种一次，停机错过的不补发。**是否发、发什么由 agent 判断**，hub 只负责按时入队。
- 早上简报：agent 写 `kind=chat`、`tier=digest` 的记录（今日重点 + 夜间要事 + 待确认数 + 今天日程）。
- 晚上提问：agent 判断当天是否已有 `author=me` 的记录、是否连续 3 天未回；要问就写 `kind=chat`、`tier=digest`、标题"今天推进了什么？"。用户在对话里回复即可，那条回复本身就是当天的笔记。
- 新增 tier `quiet`：推送但不响不震。推送的 tier：`interrupt`、`digest`、`quiet`；`log` 不推。

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/settings` | app / agent | `{morning_at: "HH:MM", evening_at: "HH:MM", evening_enabled: bool}`（后文追加 `notify`、`language`） |
| PUT | `/settings` | app / agent | 同上，三个字段都必填 → 返回新设置。agent 只在用户在对话里明确说不要晚间提问（或要恢复）时改 `evening_enabled`，并在对话里回一句确认 |

初始值写在种子文件的 `settings` 里（示例种子：`08:00`、`21:00`、`evening_enabled=true`）。`evening_enabled=false` 时 hub 不入队 `evening_prompt`。已有库里缺 `evening_enabled` 的，迁移时补 `true`。

## 日历（只读）

- hub 每 15 分钟拉取私密 iCal 链接（环境变量 `MOJITO_ICAL_URL`，必填，链接当令牌保管），展开重复事件，存未来 14 天和过去 1 天的事件。拉取成功即为数据源 `google-calendar` 心跳（`expected_interval_s=3600`）。
- Event：`{uid, start, end, all_day, title, location}`，`start`/`end` 为 datetime（全天事件为配置时区当天 00:00）。

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/calendar?from=&to=` | app / agent / worker | 两个日期都必填 → `{events}`，按 `start` 升序 |

- `GET /today` 新增字段 `schedule: [Event]`：配置时区今天的事件。

## 系统页

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/jobs?status=&runner=` | app | 任务列表（两个参数都可选，按 `requested_at` 倒序，最多 50 条）→ `{jobs}` |

系统页的服务器 agent / 本机 worker 状态 = 数据源 `server-agent` / `worker` 的心跳 + 各自 `runner` 下 `running`、`queued` 的任务数。

## 运行约定（v2a）

- 服务器 agent 在 `agent/`（uv 项目，包名 `mojito_agent`），参考部署在 `/opt/mojito/agent`，systemd 服务 `mojito-agent`，env 在 `/var/lib/mojito/agent.env`（不入库）：`MOJITO_HUB_URL=http://127.0.0.1:8787`、`MOJITO_AGENT_TOKEN`、`MOJITO_CLAUDE_BIN`、`MOJITO_GOOGLE_OAUTH`（见 v2b）、`MOJITO_TIMEZONE`，以及 Claude 凭据：`ANTHROPIC_API_KEY` 或 `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token` 生成）二选一，永不入库。
- 内存：`MemoryMax=450M`、`OOMScoreAdjust=900`；一次只跑一个任务，不常驻 claude 进程，每次 `claude -p` 跑完即退；对话上下文每次从 hub 取。
- 调 Claude 的方式同 worker：脚本取事实组好上下文，`claude -p --json-schema` 单次调用，**不给 Claude 工具**，由脚本执行结构化结果里的动作。

---

# v2b + v3 追加

依据 design.md 第 9 节。以下全部与 v2a 兼容：只加字段、加接口、加任务类型。数据库一律就地迁移。

## 写日历与撤销（agent）

- Google Calendar 的写入由 **agent 脚本直接调 Google Calendar API**（hub 不碰 Google 写接口）。凭据：服务器上的 OAuth 文件（`agent.env` 里 `MOJITO_GOOGLE_OAUTH` 指向它，必填），范围 `calendar.events`。
- agent 建的事件：`extendedProperties.private.mojito = "1"`，描述末尾加一行"由 Mojito 创建"。改和建只动带这个标记的事件（删除见后文"删日程"）。
- chat_reply 的结构化输出新增 `calendar_actions: [{op: "create" | "update" | "delete", event_id?, title?, start?, end?, location?}]`。脚本执行后，每个动作写一条记录（`kind=log`、`tier=digest`），带 `undo`。
- Record 新增字段 `undo`：`object | null`，例如 `{"type": "calendar", "op": "create", "event_id": "...", "before": null}`（`update`/`delete` 时 `before` 存原事件）。只有 agent 写的记录可以带。
- `POST /records/{id}/undo`（app）：记录必须带 `undo` 且未撤销过，否则 409 → 入队 `{kind: "undo", runner: "server", record_id}` → 返回 Job。agent 执行反向操作，写一条 `kind=log` 记录说明已撤销；hub 在原记录上标 `undone_at`（Record 新增字段 `undone_at: datetime | null`，这是 Record 唯一可被 hub 改写的字段）。
- 写入成功后 agent 调 `POST /calendar/refresh`（agent）让 hub 立即重拉 iCal。

## 草稿（对外发送只起草）

新对象 **Draft**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | 由写入方生成 |
| `at` | datetime | |
| `source` | str | 取令牌 |
| `channel` | `email` \| `message` | |
| `to` | str | |
| `subject` | str \| null | |
| `body` | str | |
| `item_id` | str \| null | |
| `status` | `pending` \| `dismissed` \| `sent_by_me` | |

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| PUT | `/drafts/{id}` | agent / worker | 新建草稿（`{channel, to, subject, body, item_id}`，status 固定 pending）；已存在 → 409 |
| GET | `/drafts?status=` | app / agent / worker | `{drafts}`，按 `at` 倒序 |
| POST | `/drafts/{id}/resolve` | app | `{status: "dismissed" \| "sent_by_me"}`；写一条 decision 记录 |

- `/today.needs_you` 新增 `drafts: [Draft]`（pending 的）。app 只提供"复制正文"和"我已发出 / 不要"，**永远不替用户发送**。

## 两周复盘

新对象 **Review**（每期计划最多一个，`id` = `plan_id`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_id` | str | |
| `created_at` | datetime | |
| `summary` | str | Claude 写的总结 |
| `completed_item_ids`, `missed_item_ids` | list[str] | 由脚本按事项状态算，不由 Claude 判断 |
| `patterns` | list[str] | 跨期规律（如"某事连续两期没完成"），每条要有依据 |
| `user_note` | str \| null | 用户当时写的话 |
| `status` | `draft` \| `done` | 用户写完 note 并确认后为 `done` |

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| PUT | `/reviews/{plan_id}` | worker | 写复盘草稿（`{summary, completed_item_ids, missed_item_ids, patterns}`）；已 `done` → 409 |
| POST | `/reviews/{plan_id}/finish` | app | `{user_note}`（必填，可为空串）→ `status=done` |
| GET | `/plans/{id}` | 同前 | 响应新增 `review: Review \| null` |
| GET | `/plans` | 同前 | 每个 Plan 新增 `review_status: "none" \| "draft" \| "done"` |

- hub 在 active 计划 `end` 当天（配置时区）的 `evening_at` 入队 `{kind: "draft_review", runner: "mac"}`，并写一条 `interrupt` 记录"该复盘了"。用户也可以提前：`POST /jobs` 现在接受 `{kind: "refresh" | "draft_review"}`。
- `draft_review`（worker）：写 Review 草稿；用 `POST /plans` 起草下一期（`status=draft`，接着上期 `end` 的第二天开始，14 天）；新事项用 `PUT /items` 写成 `waiting_you`。`draft_plan` 这个 kind 作废。
- **没复盘不开新一期**：`POST /plans/{id}/approve` 时，若存在 `end` 早于该计划 `start` 且 Review 不是 `done` 的计划 → 409。
- `/today.needs_you.plans` 里草稿计划照旧出现；app 在计划页显示复盘草稿，写 note → finish → 再批准新计划。

## 每周总结

- hub 每周日配置时区 20:00 入队 `{kind: "weekly_summary", runner: "mac"}`。worker 汇总本周记录、提交、事项变化，写一条 `kind=chat`、`tier=digest` 的记录。

## 本机 worker 的本地数据

- 邮件：Gmail API **只读**（`gmail.readonly`），凭据只在本机：`MOJITO_GMAIL_OAUTH_FILE` 指向的授权文件（一个只有 `gmail.readonly` 范围的 OAuth 桌面客户端，见 design.md 9.6）。
- Orca（可选）：`orca` CLI 的只读命令（worktree ps/list、terminal read）。不向任何终端发送输入。
- 本地 git 仓库：`MOJITO_PROJECTS_ROOT` 下的仓库，只读。
- 需要回信、发消息时只写 Draft。

## 数据源

- 任何外部脚本都可以拿一个 `source:<name>` 令牌接入：定时心跳 + 有事写 `/events`。例如实验机上的探针（`source:build-probe`：任务结束、报错、机器空闲）。
- `source:orca-hook`：Orca 里 Claude Code 的 Stop hook，会话结束时写一条 `tier=log` 记录（会话名、worktree、最后一句摘要）；需要用户处理时 `tier=digest`。
- 新令牌由 `hub/deploy/gen-tokens.sh` 生成。

## FCM 推送（v3）

- hub 环境变量 `MOJITO_FCM_CREDENTIALS`（Firebase 服务账号 JSON 路径）。有已登记设备（`POST /devices`）就走 FCM HTTP v1。
- FCM 只发 data 消息：`{record_id, item_id, title, tier, kind, reply}`（`title` 后来改名 `headline`，见"推送去重"）；`reply=true` 表示可内联回复（晚间提问）。app 本地按 tier 建通知渠道：`interrupt` 响+震，`digest` 普通，`quiet` 静默。
- 内联回复：app 后台处理后调 `POST /chat {body, item_id: null}`。

## 空中更新（v3）

- mobile 接 `expo-updates` + EAS Update，channel `production`。界面和逻辑的改动走 `eas update`；改原生（widget、FCM、依赖原生模块）才打新 APK。EAS 项目由部署者自己建。

## 桌面 widget（v3）

- 两个 Android widget：**今天概览**（今日重点前 3 条 + 待确认数 + 下一个日程，读缓存并定时刷新 `/today`）、**一键记一笔**（点开直达记一笔输入）。

## 公开页面（Google OAuth 发布要求）

Google 要求 OAuth 应用有主页和隐私政策网址才能发布为 In production。hub 提供两个**不需要令牌**的静态页面（其余接口不变，仍全部要令牌）：

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | `/` | 一句话说明：这是一个自托管的 Mojito 实例，由 `MOJITO_OWNER_NAME` 运行、只供其本人使用，不对外提供服务；联系 `MOJITO_CONTACT_EMAIL` |
| GET | `/privacy` | 隐私说明：只有运行者一人使用；读取其 Google Calendar（新建和修改只动 Mojito 自己建的事件；用户要求时可以删除任何事件）和 Gmail（只读）只为给本人显示和整理；数据存于运行者自己的服务器，不出售、不共享、不用于广告；agent 读到的内容会发给所用的模型提供方（Anthropic 的 Claude）处理；可在 myaccount.google.com/permissions 随时撤销 |

- 纯 HTML，无外部资源，不暴露任何数据。`MOJITO_OWNER_NAME`、`MOJITO_CONTACT_EMAIL` 都必填；这两页公网可见，建议用别名邮箱、只写最少信息。
- 在 Google Auth Platform 的 Branding 里填 `https://<hub 地址>/` 和 `https://<hub 地址>/privacy`，授权域名填 hub 所在的域名。

---

# 项目面板

底部页签"事项"换成"项目"，顶部切换 工作 / 生活；不属于任何项目的事项归入"其他"。

## Project

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | |
| `title` | str | |
| `area` | `research` \| `life` | 工作 / 研究，或生活 |
| `status` | `proposed` \| `active` \| `paused` \| `done` \| `declined` | `proposed` = worker 发现的新仓库，等用户确认 |
| `repo_path` | str \| null | 对应的本地仓库路径（本机上的绝对路径）；没有就 null |
| `goal_id` | str \| null | |
| `summary` | str \| null | Claude 写的一句话现状 |
| `summary_evidence` | str \| null | 依据（commit、记录 id）或 `inferred` |
| `summary_at` | datetime \| null | |
| `last_activity_at` | datetime \| null | **hub 计算**：该项目记录、快照中最新的时间 |
| `stale` | bool | **hub 计算**：`status=active` 且 `last_activity_at` 为空或早于 7 天前 |
| `open_items` | int | **hub 计算**：挂在该项目下、status ∈ {active, waiting_you, scheduled} 的事项数 |

- Item 新增 `project_id: str | null`；`PUT /items/{id}` 请求体加 `project_id`（必填，可 null）。
- Record 新增 `project_id: str | null`。写入时若带 `item_id`，hub 取该事项的 `project_id`；否则用请求体里的 `project_id`。
- `POST /records`、`POST /chat` 请求体加 `project_id`（必填，可 null）。`GET /chat` 加可选 `project_id` 过滤。
- `POST /events` 请求体加 `project_id`（必填，可 null）和 `repo_path`（必填，可 null）：`project_id` 为 null 而 `repo_path` 不为 null 时，hub 按 `repo_path` 前缀匹配 Project 的 `repo_path`（worktree 路径在 `~/orca/workspaces/<repo 名>/...` 下时按 repo 名匹配）。Orca Stop hook 用这个。

## Orca 快照

每个项目只存最新一份，由 worker 覆盖写。

```jsonc
{
  "taken_at": "...",
  "worktrees": [{"name", "branch", "path", "status", "last_output", "last_activity_at"}],
  // status 取 Orca 的 workspaceStatus；last_output 为终端最后输出的一句摘要（已脱敏，≤200 字）
  "commits": [{"repo", "sha", "subject", "at"}]   // 最近 7 天，最多 20 条
}
```

## 接口

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/projects?area=&status=` | app / agent / worker | `{projects}`；不给 status 时返回 active + paused |
| GET | `/projects/{id}` | app / agent / worker | `{project, items, snapshot, records}`；records 为最近 50 条，倒序 |
| PUT | `/projects/{id}` | worker | 新建或更新（`{title, area, status, repo_path, goal_id}`）。worker 只能新建 `proposed`；已有项目只能改 `repo_path`（后文放开） |
| PUT | `/projects/{id}/snapshot` | worker | 覆盖 Orca 快照 |
| PUT | `/projects/{id}/summary` | worker | `{summary, summary_evidence}`，hub 写 `summary_at` |
| POST | `/projects/{id}/decision` | app | `{action: "approve" \| "decline" \| "pause" \| "resume" \| "done"}`：approve 仅对 proposed → active；decline → declined；其余改状态。写一条 decision 记录 |
| POST | `/projects` | app | 手动新建（`{id, title, area, repo_path, goal_id}`，status 固定 active） |

- `/today.needs_you` 新增 `projects: [Project]`（proposed 的）。
- Job kind 新增 `sync_projects`（runner=mac）：hub 每 30 分钟入队一次（已有 queued/running 的就不重复入队）；`refresh` 完成时 worker 也顺带做一次。
- worker 的 `sync_projects`：读 `orca repo list` / `orca worktree list`（只读），按 `repo_path` 对上项目后写快照；Orca 里有、hub 里没有的仓库 → `PUT` 一个 `proposed` 项目。每次 refresh 为每个 active 项目写一句 summary（有依据才写，否则 `inferred`）。

## 种子里的项目

种子文件的 `projects` 在 hub 启动、projects 表为空时导入；`item_projects` 同时给已有事项补 `project_id`。示例种子（`docs/seed.example.json`，虚构）里是：

| id | title | area | repo_path |
|---|---|---|---|
| `p-loaflog` | Loaflog | research | `~/code/loaflog`（本机仓库的路径） |
| `p-app` | Mojito | research | `~/code/mojito` |
| `p-guitar` | Guitar | life | null |
| `p-closet` | Closet clear-out | life | null |

`item_projects`：`i-lf-onboarding` → `p-loaflog`，`i-gt-song3` → `p-guitar`，`i-cl-donate` → `p-closet` 等。

---

# 使用记录、授权状态、早上简报有声

## 早上简报改为有声

`morning_brief` 写的记录 `tier=digest`（普通通知，有声音）。`quiet` 这个等级保留，暂无使用方。

## 使用记录

app 记下每次打开了哪个页面、用了哪个动作，存在 hub；两周后出"哪些用了、哪些没用"的统计。

UsageEvent：`{at, kind: "view" | "action", name, detail}`

- `view` 的 `name`：`today`、`plan_current`、`plan_history`、`plan_detail`、`projects`、`project_detail`、`items`、`item_detail`、`feed`、`chat`、`system`、`note_sheet`，以及 widget 打开（`widget_today`、`widget_note`）、点通知打开（`push_open`）。
- `action` 的 `name`：`note`（detail 带 `needs_processing` 真假）、`decision`（detail 带 approve/decline/postpone 和对象类型）、`refresh`、`chat_send`、`item_ask`、`undo`、`draft_copy`、`draft_resolve`、`review_finish`、`review_start`、`settings_save`、`open_orca`、`inline_reply`（通知栏回复）。
- `detail`：object | null，只放上面说的枚举类信息，**不放正文内容**。

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| POST | `/usage` | app | `{events: [UsageEvent]}`，批量上报；app 本地攒着，每次回到前台或攒满 20 条时发一次，失败下次再发 → 204 |
| GET | `/usage/summary?from=&to=` | app / agent / worker | 两个日期必填（配置时区） → `{views: {name: count}, actions: {name: count}, days_active, unused: [name]}`；`unused` = 上面两张枚举表里计数为 0 的名字 |

- worker 起草复盘时调 `GET /usage/summary`，在 summary 末尾加一段"这两周用了哪些、没用哪些"。

## 授权状态

外部授权失效时（Google refresh token 被撤销或过期、Claude 凭据失效），系统页要能看出来。

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| PUT | `/auth-status/{name}` | agent / worker | `{ok: bool, detail: str \| null}` → hub 写 `checked_at`。`ok` 由 true 变 false 时 hub 写一条 `interrupt` 记录"授权失效：<name>"；由 false 变 true 时写 `digest`"授权恢复：<name>" |
| GET | `/auth-status` | app / agent / worker | `{auth: [{name, ok, detail, checked_at}]}` |

- `name` 取值：`google-calendar-write`（agent，每小时和每次启动用 refresh token 换一次 access token）、`gmail-read`（worker，同样频率）、`claude-server`（服务器 agent，`claude -p` 返回认证错误时报 false，下一次成功时报 true）、`claude-mac`（本机 worker，同上）。
- 检查失败的 `detail` 写错误类型（如 `invalid_grant`），不写令牌内容。
- 系统页在数据源列表下加"授权"一栏：每项绿/红，红的显示 detail 和"怎么修"（Google：本机跑 `uv run hub/deploy/google-auth.py` 再 `hub/deploy/install-secrets.sh`；Claude：更新服务器 `agent.env` 里的 Claude 凭据后同样 install-secrets）。
- Google OAuth 应用停在 Testing 状态时，refresh token 7 天过期；发布为 In production（需要上面的公开页面）并重新授权后不再 7 天过期，但改密码、6 个月不用、手动撤销仍会失效。

## 凭据拆分

- 服务器上 `MOJITO_GOOGLE_OAUTH` 指向的文件只含 `calendar.events`（日历用的 OAuth 客户端）；agent 只请求这个范围。
- worker 读 `MOJITO_GMAIL_OAUTH_FILE`（另一个 OAuth 客户端，只有 `gmail.readonly`）。
- `hub/deploy/google-auth.py` 参数化：`--client <client json> --scope calendar|gmail --out <file>`，缺参数就报错。

---

# 对话发图片

- 用途只有一个：**让 Claude 看图回答**。图片不作为事项附件，不进事项详情的材料。
- **永久保存**（app 端压缩后每张约 300KB）。
- 对话页和事项详情的"问问这件事"都能发图；可以只发图、也可以图 + 文字。

## Attachment

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | hub 生成 |
| `content_type` | `image/jpeg` | app 上传前统一转 JPEG |
| `bytes` | int | |
| `width`, `height` | int | |
| `created_at` | datetime | |

## 接口

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| POST | `/attachments` | app | `multipart/form-data`，字段 `file`；只收 `image/jpeg`，≤ 5 MB，否则 422 → Attachment |
| GET | `/attachments/{id}` | app / agent / worker | 原图字节，`Content-Type: image/jpeg` |

- `POST /chat` 请求体新增 `attachment_ids: [str]`（必填，可为空列表；最多 4 张；引用不存在或已被别的消息用过的 id → 422）。`body` 允许为空串，但 `body` 为空时 `attachment_ids` 不能为空。
- Record 新增 `attachments: [Attachment]`（只有对话消息会有，其余为空列表）。`title` 在 `body` 为空时写"[图片]"。
- 文件存在 `MOJITO_ATTACHMENTS_DIR/<id>.jpg`（参考部署 `/var/lib/mojito/attachments/`），属主为 hub 的服务用户、权限 600；数据库只存元数据。部署脚本的数据库备份不包含图片；图片目录另外备份（见"稳定性与安全"）。
- app 上传前处理：长边缩到 ≤ 1600px，JPEG 质量约 0.8，去掉 EXIF（包括定位）。

## Claude 怎么看图

- agent / worker 用 `GET /attachments/{id}` 取图，**以 `claude -p --input-format stream-json` 的 image content block（base64）**传给 Claude，仍然**不给 Claude 任何工具**，不落盘到 Claude 可读的目录。
- 转给本机的对话同样带图，worker 用同样方式处理。
- 推送标题在只发图时写"[图片]"。

---

# 信息流 + 对话里改事项

## A. 信息流（第五个底部页签）

- **动态** = 发生了什么（事件，一行一条，用于核对）。
- **信息流** = 值得读的东西（卡片）。有尽头，有"上次读到这里"。

### Card

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | hub 生成 |
| `at` | datetime | |
| `source` | str | 取令牌（如 `worker`、`cards`） |
| `origin` | str | 具体来源名：`arxiv`、`session:<Orca worktree 名>` 等 |
| `kind` | `paper` \| `idea` \| `report` \| `other` | 后文追加 `mail`、`post` |
| `project_id` | str \| null | |
| `title` | str | |
| `summary` | str | ≤ 800 字；Claude 写的要说明为什么值得看 |
| `link` | str \| null | 原文链接（http/https）；没有就 null |
| `dedupe_key` | str | 同一来源内唯一，重复发布 → 409 |
| `status` | `new` \| `saved` \| `dismissed` | |
| `item_id` | str \| null | 转成事项后指向那个事项 |

### 接口

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| POST | `/cards` | worker / `source:cards` | `{origin, kind, project_id, title, summary, link, dedupe_key}` → Card |
| GET | `/cards?before=&limit=&status=&project_id=` | app / agent / worker | `limit` 必填；不给 status 时返回 new + saved → `{cards, last_read_id}`，按 `at` 倒序 |
| POST | `/cards/{id}/status` | app | `{status: "saved" \| "dismissed" \| "new"}` → Card |
| POST | `/card-reads` | app | `{card_id}` → 204 |
| POST | `/cards/{id}/to-item` | app | 写一条带 `needs_processing=true` 的笔记（正文含卡片标题、摘要、链接，`project_id` 同卡片）并入队 `process_note` → 返回 Job；worker 照常起草 `waiting_you` 事项；hub 在草稿事项写回时把卡片的 `item_id` 填上（process_note 的笔记记录带 `card_id` 字段，Record 新增 `card_id: str \| null`） |

- **问问这个**：`POST /chat` 请求体新增 `card_id`（必填，可 null）。agent/worker 回答时把卡片内容放进上下文。
- 卡片不推送。早上简报里提一句"信息流新增 N 张"。
- 使用记录的 view 表加 `feed`（信息流页）、`card_detail`；action 表加 `card_save`、`card_dismiss`、`card_ask`、`card_to_item`。原来的 `feed`（动态页）改名 `timeline`。

### 来源 1：论文日报（worker 定时）

- hub 每天配置时区 07:00 入队 `{kind: "feed_arxiv", runner: "mac"}`（同一天一次；后文改名 `feed_papers` 并按订阅时间入队）。
- worker：用 arXiv 公开 API 取前一天 `MOJITO_ARXIV_CATEGORIES`（逗号分隔，例如 `cs.AI,cs.HC`）里的新提交（事实，脚本）；把标题 + 摘要 + 当前 active 项目的 summary 交给 `claude -p` 挑最相关的 ≤ 5 篇，每篇写"为什么和你有关"（判断，Claude）；`POST /cards`，`origin=arxiv`、`kind=paper`、`link`=abs 页、`dedupe_key`=arXiv id、`project_id`=最相关的项目或 null。

### 来源 2：会话主动发布

- 仓库提供命令 `sources/cards/mojito-card`（装到 `~/.local/bin/mojito-card`）：
  `mojito-card --project <id|none> --kind <paper|idea|report|other> --title <...> --summary <...> [--link <url>] [--key <dedupe>]`
  读 `~/.config/mojito/secrets/cards.env`（`MOJITO_HUB_URL`、`MOJITO_CARDS_TOKEN`，令牌角色 `source:cards`）；`origin` 自动取当前 Orca worktree 名（`session:<名>`），不在 Orca 里就报错要求 `--origin`；`--key` 不给时用 title 的哈希。
- 只在会话**主动**判断"有值得看的结果"时调用（如一个调研会话找到候选方案、实验报告完成）。**不自动抓会话输出**；会话结束之类的事件仍走 Orca Stop hook 进动态。
- 用法不写进全局 Claude 指令或各项目 CLAUDE.md；需要时用户在会话里直接叫它发。
- 卡片去重键为 `(origin, dedupe_key)`。

## B. 对话里直接改事项

依据 design.md 9.1"写自己的数据直接做"。agent（和 worker 的 chat_reply）结构化输出新增：

```jsonc
"item_updates": [{
  "item_id": "i-gt-song3",
  "changes": { "next_step"?: str, "next_at"?: datetime|null, "status"?: "active"|"waiting_you"|"scheduled"|"standing"|"done"|"closed",
               "owner"?: "auto"|"me"|"auto_then_me", "title"?: str, "project_id"?: str|null }
}],
"plan_changes": null | { "add_item_ids": [str], "remove_item_ids": [str], "goal_ids": [str] | null }
```

- `done_definition` 永远不能改。用户说"做完了"就直接 `status=done`。
- **item_updates 直接执行**：hub 放开 agent / worker 的 `PUT /items/{id}` 对已有事项的修改（`done_definition` 不同仍 409）。改动记录由 hub 写（见下方"补充"第 3 条）。
- 撤销：`POST /records/{id}/undo` 对 `type=item` 的记录由 **hub 直接恢复** `before` 里的字段（不经 agent），写一条"已撤销"记录，标 `undone_at`，返回的 Job 直接是 `done`。若事项在这之后又被改过同一字段 → 409（"之后又改过，不能撤销"）。
- **plan_changes 起草进"等你拍板"**：agent 用 `POST /plans` 起草一个修订版计划（同 `start`/`end`，按 changes 调整 `item_ids`/`goal_ids`），Plan 新增字段 `revises: str | null` 指向被修订的计划。批准修订版时，被修订的计划置 `closed`、不要求复盘。agent / worker 都可以 `POST /plans`。（后文"大批改进"第 5 条修订：用户亲口要求的直接改。）

## 部署顺序

凡是请求体新增必填字段（比如 `POST /chat` 的 `card_id`），**app 先通过空中更新带上，hub 后部署**。

### 补充（回答 worker 联调问题）

1. `POST /plans` 请求体加 `revises`（**可选**，不给即 null；为兼容已有 worker 调用）：`draft_review` 起草传 null；`plan_changes` 起草传被修订计划 id。
2. 修订版计划 id = `<被修订 id>-r<配置时区 YYYYMMDDHHMMSS>`，`start`/`end` 同原计划。新修订版起草成功时，hub 把同一计划下旧的 draft 修订版置为 `closed`。
3. **事项改动记录由 hub 写**：agent / worker 用 `PUT /items/{id}` 改已有事项时（全量写回：以当前事项为底，只覆盖要改的字段，`done_definition` 原样带回），hub 比较前后值，对每个改了的事项写一条 `kind=log`、`tier=log` 记录（标题"<事项>：<字段> 从 X 改成 Y"，`source` 取令牌，`project_id` 同事项），带 `undo = {"type": "item", "item_id", "before": {改了的字段原值}}`。agent / worker **不**为 item_updates 另写记录；`POST /events` 仍然只允许 agent 带 undo（日历）。首次创建事项不写这条记录。
4. 新增 `GET /cards/{id}`（app / agent / worker）→ Card，不论 status。"问问这个"按 card_id 取卡片用它。

## 事项的完成 / 关闭

事项**不删除**，"删掉"一律等于 `status=closed`（和记录只追加一致）。

- `POST /items/{id}/decision` 的 `action` 扩展为：`approve` | `decline` | `postpone` | `done` | `close` | `reopen`。
  - `done` → `status=done`；`close` → `status=closed`；`reopen` → `status=active`（仅对 done/closed）。
  - 这三个对任何进行中状态都可用；写 decision 记录，并按"补充"第 3 条由 hub 写带撤销的"从 X 改成 Y"记录。
- app 事项详情：进行中的事项显示"完成""关闭"两个按钮（关闭前确认一次）；已完成/已关闭的显示"重新打开"。
- agent / worker：用户说"删掉 / 不要了 / 取消" → `item_updates` 里 `status=closed`；说"做完了" → `done`。**回复里不许声称 app 有它其实没有的功能**；不确定时说"你可以在事项详情点完成/关闭"。

---

# 反馈与自动修复（见 design.md 9.7）

## Feedback

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | hub 生成 |
| `at` | datetime | |
| `body` | str | 用户原话 |
| `attachments` | [Attachment] | 截图（复用对话的附件接口） |
| `context` | object | `{screen, item_id, project_id, app_update_id}`，都可为 null |
| `status` | `open` \| `triaged` \| `fixing` \| `awaiting_approval` \| `shipped` \| `declined` | |
| `ship_mode` | `auto` \| `ask` \| null | 维护会话分诊后填 |
| `summary` | str \| null | 维护会话写：问题是什么、打算怎么改 / 改了什么、怎么生效 |
| `updated_at` | datetime | |

## 接口

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| POST | `/feedback` | app | `{body, attachment_ids, context}` → Feedback（status=open），同时写一条 `kind=feedback`、`author=me` 的记录（Record kind 新增 `feedback`） |
| GET | `/feedback?status=` | app / maintainer | `{feedback}`，按 `at` 倒序 |
| GET | `/feedback/{id}` | app / maintainer | Feedback |
| PUT | `/feedback/{id}` | maintainer | `{status, ship_mode, summary}` → Feedback。状态变为 `awaiting_approval` 时进"等你拍板"；变为 `shipped` / `declined` 时 hub 写一条 `tier=digest` 记录（标题"已修复：…" / "没改：…"，正文=summary）并推送 |
| POST | `/feedback/{id}/decision` | app | `{action: "approve" \| "decline"}`，仅对 `awaiting_approval`；approve → `fixing`（维护会话继续上线），decline → `declined`；写 decision 记录 |

- 新令牌角色 `maintainer`：只能调上表的 maintainer 接口，以及 app 组全部 `GET`（含 `/attachments/{id}`）。令牌放本机 `~/.config/mojito/secrets/maintainer.env`（`MOJITO_HUB_URL`、`MOJITO_MAINTAINER_TOKEN`），不入库。
- `/today.needs_you` 新增 `feedback: [Feedback]`（awaiting_approval 的）。
- 使用记录：view 加 `feedback_sheet`，action 加 `feedback_send`、`feedback_decision`。
- app：系统页"反馈与建议"入口（对话里的建议由 agent 代提交，见"大批改进"第 6 条）；可附截图；自动带 context（当前页面、事项/项目、当前 JS 包 updateId）。
- **现状**：hub 不校验 `status` 的流转，也不记录反馈是谁提交的（用户亲手还是 agent 代发）；`ship_mode` 的分级完全由维护会话判断（design.md 9.7"现状与限制"）。

## 兼容规则（一次真机事故后修订）

事故：app 先通过空中更新带上新字段 `card_id`，但旧 hub 对请求体"多出的字段"一律 422（`extra_forbidden`），导致部署前对话发不出去。

- hub **忽略请求体里不认识的字段**（记一行 warning：路径 + 字段名，不记值）；缺少必填字段仍然 422。这样"app 先带上新字段、hub 后部署"才成立。
- 以后新增必填字段的上线顺序不变：app 先（空中更新），hub 后。
- app 的报错提示：不把原始 JSON 给用户看。显示一句人话（如"没发出去：服务器暂时不接受这条消息，已记下"），点开才看细节；同时把错误作为一条使用记录上报（action `client_error`，detail 只放 路径 + 状态码）。

## 今日重点规则（被"准绳落地"一节取代）

- `/today.focus` = 所有 `status ∈ {active, waiting_you, scheduled}` 且 `next_at` 落在**配置时区今天**的事项，按 `next_at` 升序。不再以两周计划为范围。
- `forgotten`：`status ∈ {active, waiting_you}` 且（`next_at` 为空，或 `next_at` 早于配置时区今天 00:00）。
- app 今日重点的小标题为"今天到期"；没有时显示"今天没有到期的事"。
- 早上简报的"今日重点"按同一规则。

## "动态"页签换成"笔记"

底部页签：今天 / 计划 / 项目 / 信息流 / **笔记**。

- **笔记页**：顶部输入框 → 下面是用户自己记的所有笔记（`author=me`、`kind=note`），倒序（后文"简化"一节修订了笔记页）。
- **动态**不再是页签，移到系统页"全部动态"入口（撤销按钮、系统事件、Claude 改过什么都在这里核对）。"上次读到这里"保留在动态里。今天页"夜里"照旧显示未读告警。
- `GET /records` 新增可选过滤参数 `kind`、`author`、`project_id`（都可不给）。笔记页用 `GET /records?kind=note&author=me&limit=`。
- 使用记录 view 表加 `notes`（笔记页）。

## 每次更新都推送通知

任何新版本上线后，自动往 app 推送一条（`POST /events`，`kind=log`、`tier=digest`，用本机 `~/.config/mojito/secrets/cards.env` 的 `source:cards` 令牌；`source` 取令牌）：

| 什么时候 | 谁发 | 标题 | 正文 |
|---|---|---|---|
| `npm run update`（空中更新）发布成功 | mobile 的 update 脚本 | "app 已更新：<一句话>" | 改了什么（用户看得懂的 1–3 条）+ "划掉 app 再打开两次生效，系统页底部版本号 <updateId 前 8 位>" |
| 新 APK 打好 | mobile 的 build 脚本 | "新安装包：<一句话>" | 改了什么 + "需要重装：<安装包位置>" |
| `deploy.sh` 部署成功 | infra 的 deploy 脚本 | "服务器已更新：<一句话>" | 用户能感知的变化（没有就写"无可见变化"） |

- 一句话说明由执行者通过脚本参数传入（`npm run update -- --message "..."`；`deploy.sh main "<说明>"`），缺说明就报错不发布。
- 正文遵守"写给用户看的文字"规则：用用户的界面语言、不写内部 id、不写英文枚举。

---

# 大批改进

## 1. 论文信息流：按口味挑

**口味档案**（worker 维护，事实靠脚本）：
- Zotero 库（可选）：`MOJITO_ZOTERO_DB` 指向本机的 `zotero.sqlite`（只读），不用 Zotero 时写 `none`。
- active 项目的 summary；卡片信号：`GET /cards?status=saved`（喜欢）、`status=dismissed`（不喜欢）。
- 口味笔记（用户在对话里说的偏好）：新对象 **TasteNote** `{id, at, text, source}`。
  - `GET /taste`（app / agent / worker）→ `{notes}`；`POST /taste`（agent / worker）`{text}` → TasteNote；`POST /taste/{id}/retire`（app / agent）→ 不再生效。
- 关注作者：从 Zotero 里出现 ≥3 次的作者自动得出，外加口味笔记里点名的。

**扫描与筛选**（`feed_arxiv` 改名 `feed_papers`，worker）：
- 来源：arXiv `MOJITO_ARXIV_CATEGORIES` 里最近一个有论文的提交日（往回找 ≤4 天）；Hugging Face 每日论文（`https://huggingface.co/api/daily_papers`）；关注作者的新论文（arXiv 作者查询）。去重按 arXiv id。
- 第一轮：标题 + 口味档案 → claude -p 粗筛 ≤40 篇；第二轮：读摘要 → 精选 5–10 篇。
- 卡片：`kind=paper`，`summary` 写"做了什么（一句）+ 为什么你会感兴趣 + 和哪个项目有关"，`project_id` 选最相关的 active 项目或 null，`origin` = `arxiv` / `hf-daily` / `author:<名>`。
- 周日配置时区 20:00（和 weekly_summary 同时）加一张 `kind=report` 的"本周论文"卡片：本周最值得读的 3 篇 + 趋势。
- Job kind：`feed_arxiv` → `feed_papers`；新增 `feed_weekly`（mac）。

## 2. 大 widget（4×6）

日期 +"今天到期 N · 等你拍板 N" → 今天到期（≤5，点开事项）→ 等你拍板（≤2，点开今天页）→ 被忘了（≤2）→ 底部两个按钮"笔记""对话"。**不放日程。** 小"笔记"widget 保留。原生改动，随下一个 APK。

## 3. "需要你"改名"等你拍板"，只放 Claude 主动提出的

- 名称改为"等你拍板"（`/today.needs_you` 字段名不变）。
- 每张卡片写清后果，例："同意后：这件事进入你的事项列表"、"不要：这件事关闭"。
- **用户在对话里亲口要求的改动一律直接执行并附撤销，不进等你拍板。** 等你拍板只放：请处理笔记整理出的事项草稿、复盘后起草的下一期计划、对外草稿、新发现的仓库、维护会话要确认的修复。

## 4. 不叫"记一笔"

所有"记一笔"改为"笔记"；右下角浮动按钮改为两个："笔记""对话"；事项详情"给这件事记一笔"改为"写笔记"。使用记录 view `note_sheet` 不变。

## 5. 对话里能直接改（全部附撤销；对外发送仍只起草）

hub 在以下写操作时像事项一样**自动写"从 X 改成 Y"记录并带撤销**（`undo.type` = `goal` / `plan` / `project` / `settings`，撤销由 hub 直接执行，规则同事项）：

| 对象 | 接口（agent / worker 可用） | 可改 |
|---|---|---|
| Goal | `PUT /goals/{id}`（新建或更新）`{title, status}` | 新建、改名、`active/done/dropped` |
| Plan | `PUT /plans/{id}` `{start, end, goal_ids, item_ids}`（仅 active 或 draft） | 加减事项、目标，改日期 |
| Project | `PUT /projects/{id}` `{title, area, status, repo_path, goal_id}`；`POST /projects` | 新建、改名、改分组、暂停/完成/恢复 |
| Settings | `PUT /settings`（已有） | 全部字段 |
| Card | `POST /cards/{id}/status`（放开 agent / worker） | 收藏、不感兴趣 |
| 笔记归属 | `POST /records/{id}/link` `{item_id, project_id}`（仅 `kind=note`、`author=me` 的记录） | 挂到事项/项目 |

- 原来"plan_changes 起草修订版进等你拍板"改为：用户要求时**直接** `PUT /plans/{id}`；Claude 自己想到的调整才起草修订版进"等你拍板"。
- worker 对已有项目的 `PUT /projects` 限制取消（仍只有 sync 发现的新仓库以 `proposed` 新建）。
- Record 的 `item_id`、`project_id` 只允许通过 `/records/{id}/link` 修改，且写一条改动记录；其余字段仍只追加不修改。
- agent / worker 输出新增：`goal_updates`、`plan_updates`、`project_updates`、`settings_update`、`card_actions`、`note_links`、`taste_notes`（字符串列表，写入口味档案）。

## 6. 在对话里提改进建议（反馈线程）

- agent 识别到"给 app 的建议 / 问题"时，代用户 `POST /feedback`（放开 agent 令牌，`context.screen = "chat"`，附带原消息的图片），回复"已转给维护会话"。
- **FeedbackMessage** `{id, feedback_id, at, author: "me" | "maintainer", body, attachments}`：
  - `GET /feedback/{id}/messages`（app / maintainer / agent）；`POST /feedback/{id}/messages`（app / maintainer / agent）`{body, attachment_ids}`。
  - 维护会话发消息时，hub 同时写一条 `kind=chat`、`source=maintainer`、`tier=digest` 的对话记录（Record 新增 `feedback_id`），推送给用户。
  - 用户在对话里回复时，agent 判断是在回维护会话的问题（最近一条相关的 maintainer 消息），输出 `feedback_reply: {feedback_id, body}`，由 agent 写成 FeedbackMessage（author=me），并回复"已转给维护会话"。
- 系统页"反馈问题"改名"反馈与建议"，每条可点开看完整讨论并回复。
- 安全：agent 代提交的反馈可能源自卡片、邮件等第三方内容。维护会话按 `docs/maintainer.md` 的规则核对它能否对上用户本人在对话里的原话，对不上就按 `ask` 处理（维护会话判断，代码不强制）。

## 7. 稳定性与安全

- a. 代码推到你自己的**私有**远端仓库。维护会话每次合并到 main 后 `git push origin main`；推送前确认远端是私有的。
- b. 每晚 03:00（本机时间），本机用 launchd 拉备份：hub 在服务器上用 sqlite backup 生成快照，本机 rsync 快照和附件目录到 `~/mojito-backup/`（保留 14 天快照，附件增量）。
- c. 本机 launchd 每 10 分钟检查 hub 的公开页 `https://<hub 地址>/`；连续 2 次失败用 macOS 通知提醒"hub 连不上"，恢复后再提醒一次。
- d. `process_note`：笔记太含糊（Claude 判断不出要做什么）时不起草事项，改为在对话里问用户（`kind=chat`、`tier=digest`），笔记保持未处理。
- e. hub 关闭公开的 `/docs`、`/redoc`；`/openapi.json` 改为需要 app 令牌。
- f. 服务器加固由部署者负责：只开必要端口，SSH 建议只在 tailnet 内开放，服务器上不留用不到的私钥。
- g. "全部动态"默认隐藏标题以"【测试】"开头的记录（可切换显示）。
- h. 模块会话闲置时关闭，只留维护会话常驻。

### 第 5 节输出结构（worker 提议，采纳）

- `goal_updates` / `project_updates`：`[{goal_id | project_id, changes: {只放要改的字段}}]`；id 不存在即新建，新建时字段必须齐（goal：`title,status`；project：`title,area,goal_id`，走 `POST /projects`）。
- `plan_updates`：`[{plan_id, add_item_ids, remove_item_ids, goal_ids|null, start|null, end|null}]`（null = 不改）→ `PUT /plans/{id}` 全量。
- `plan_changes`：仅 Claude 主动建议时用，起草修订版进"等你拍板"。
- `settings_update`：`null | {changes: {morning_at?, evening_at?, evening_enabled?}}` → 先 `GET /settings` 合并再 `PUT`。
- `card_actions`：`[{card_id, status}]`；`note_links`：`[{record_id, item_id, project_id}]`；`taste_notes`：`[str]`。
- hub 调用遇 502/503/504 或连接错误：退避 1、2、4、8、15 秒重试；其他 4xx 与读超时不重试。
- 用户在对话里要求新建的事项直接 `status=active`；hub 放开 agent / worker 新建事项的 status 限制（任何合法状态）。只有 process_note（请处理笔记）起草的仍是 `waiting_you`。
- `POST /feedback` 的 `attachment_ids` 可以复用已挂在对话消息上的附件（"一个附件只能被一条消息用"的限制只在 `POST /chat` 之间）。

---

# 准绳落地（见 design.md 第 0 节）

## 今日重点 v3（取代"今日重点规则"）

- `/today.focus`：进行中（active / waiting_you / scheduled）事项里，`next_at` 在配置时区今天的全部；**另加**今天之后最近的一件（若今天之后还有）。每条 Item 附加只读字段 `days_until`（int，今天 = 0，由 hub 计算，只在 /today 里出现）。今日重点永不为空，除非没有任何带 `next_at` 的进行中事项。
- `/today.overdue`（新）：进行中、`next_at` 早于配置时区今天 00:00、且 `updated_at` 在 7 天内的事项 → 琥珀。
- `/today.forgotten`：进行中、`next_at` 为空，或 `next_at` 过期且 `updated_at` 超过 7 天 → 红。Item.forgotten 同此规则。
- 下一步是"今天能做的一小步"：agent 的 `evening_prompt` 回复处理、worker 的 `refresh`、`chat_reply` 都要按计划进度、日历和晚间回复更新 focus 里事项的 `next_step`（和必要时的 `next_at`），改动记录由 hub 自动写。

## 检验指标

- 使用记录 view 新增 `app_open`（app 冷启动或回到前台各记一次）。
- `GET /metrics?from=&to=`（app / agent / worker / maintainer，配置时区的日期）→ `{days: [{date, opens, evening_asked, evening_replied}], totals: {opens, evening_asked, evening_replied}}`。`evening_replied` = 当天晚间提问之后到次日 04:00 前有 `author=me` 的对话或笔记。
- 系统页顶部显示最近 7 天两数；每周总结（worker）写进这两个数和趋势。

## 维护会话心跳与看门狗

- maintainer 令牌可调 `POST /sources/maintainer/heartbeat`（`expected_interval_s=900`）。看门狗对 `maintainer` 用 30 分钟判失联（hub 对该源失联阈值 = 2 × expected），失联写 interrupt 推送。
- worker 看门狗：每 5 分钟 `GET /sources`，`maintainer` 失联 ≥ 30 分钟且过去 60 分钟内没拉起过 → `orca terminal create --worktree path:<主 checkout> --title "mojito 维护" --command "claude '你是 mojito 的维护会话。完整读 docs/maintainer.md 并照做。'"`，再 `POST /events` 推送"维护会话失联，已开新会话接班"。这是本机 worker 对 Orca 唯一允许的写操作。当前实现需要 Orca；不用 Orca 时维护会话失联只会推送告警，要自己重开。

## 数据源结果健康

- Source 新增 `health: "ok" | "warn" | "error" | null`、`health_detail: str | null`、`health_at`。
- `POST /sources/{name}/health`（该源令牌，或 worker 代报 `feed-papers`、`sync-projects` 等 worker 任务型源）`{health, detail}`。由 ok 变为 warn/error 时写 digest 记录并推送；恢复时写 log。
- 必报：`feed_papers` 当天 0 张卡片 → warn（写原因：抓到 0 篇 / 筛完 0 篇）；抓取失败 → error。`sync_projects` 失败 → error。日历拉取失败 → error。

### 补充（回答 hub / worker 联调问题）

1. **worker 任务型数据源**：worker 令牌可以为 `feed-papers`、`sync-projects` 两个名字 `POST /sources/{name}/heartbeat` 和 `POST /sources/{name}/health`（和 `worker` 本身一样）；其他名字仍 403。首次心跳即登记。worker 每次跑完该任务先心跳再报健康；`expected_interval_s`：`feed-papers` = 93600（26 小时），`sync-projects` = 3600。
2. "大批改进"第 5 节表里写的 agent / worker 权限照表实现：`GET /settings`、`PUT /settings` 放开 worker；`POST /projects` 放开 worker。
3. 笔记归属撤销 `undo.type = "note"`；overdue / forgotten 的"进行中"= active / waiting_you / scheduled。

---

# 简化（design.md 8.3）

- **笔记一律整理**：app 发 `POST /records` 时 `needs_processing` 固定 `true`、`project_id` 固定 null；worker 的 `process_note` 改为三选一：
  1. 要办的事 → `PUT /items` 新建 **`status=active`** 事项（不再是 waiting_you），并 `POST /records/{note_id}/link` 把笔记挂到该事项；回一条对话"已记成事项：<标题>"（`tier=log`，不推送）。
  2. 想法/记录 → 只 `POST /records/{note_id}/link` 挂到最相关的项目（或不挂）。
  3. 看不懂 → 在对话里问（`tier=digest`）。
- **撤销整理**：hub 在 process_note 任务里新建事项时，自动写一条"由笔记记成事项：<标题>"记录，带 `undo = {"type": "item_create", "item_id"}`；撤销 = 事项置 `closed` 并解除笔记的 item_id 挂接。
- **删除笔记**：`POST /records/{id}/hide`（app，仅 `author=me` 的笔记）→ Record 新增 `hidden_at`；列表与 `/records` 默认不返回已隐藏的（`include_hidden=true` 才返回）。记录本身不删。
- 信息流卡片的 saved/dismissed 接口保留但 app 不再使用；口味档案改为主要依据口味笔记和"问问"过的卡片（`POST /chat` 带 card_id 的记录）。
- "等你拍板"的事项草稿只剩"同意 / 不要"（`postpone` 接口保留，app 不再用）。

---

# Mac app 取新事件（design 8.4）

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/pulse?after=&limit=` | app | 新事件 + 菜单栏/角标计数 |

- 参数：`after` = 上次返回的 `cursor`（可选）；`limit` 必填（1–100，建议 50）。
- 响应：`{cursor: str, records: [Record], more: bool, counts: {due_today: int, needs_you: int}}`
  - `cursor`：不透明游标，下次原样传回。
  - `records`：`after` 之后新写的、`tier ∈ {interrupt, digest, quiet}` 的记录（和手机推送同一范围），按写入先后升序，最多 `limit` 条；不含已隐藏的。
  - `more`：还有没取完的，立刻再调一次。
  - `counts.due_today`：`/today.focus` 里 `days_until = 0` 的条数（菜单栏改为显示"下一件事"后暂不用）；`counts.needs_you`：等你拍板总数 = `needs_you` 里 items + plans + drafts + projects + feedback（Dock 角标）。
- 不给 `after`（首次启动或本地没有游标）：`records` 为空，只返回当前 `cursor` 和 `counts`，不把历史当新事件弹出。
- Mac 端：运行期间每 30 秒调一次；游标存本地。按 `settings.notify[category]` 过滤后，`interrupt` / `digest` 弹 macOS 通知、`quiet` 静默（与手机推送范围一致，design 8.6）；主窗口在前台时不弹。每次都用 `counts` 更新菜单栏和角标。
- 断线 / 睡眠补漏：拿旧 `cursor` 调用即可补齐，`more=true` 时连续取完；补回的 `interrupt` 超过 3 条合并成一条"有 N 条新提醒"。
- 失败：401 / 403 → 提示重新输入令牌；网络错误或 5xx → 下次照常重试，游标不丢。
- 手机仍走 FCM，Mac 走 `/pulse`，互不去重。Mac 启动 / 回到前台照常上报 view `app_open`。

---

# 删日程、订阅、每日邮件（design.md 8.5）

## 删日程
- `POST /calendar/{uid}/delete`（app）→ 入队 `{kind: "calendar_delete", runner: "server", record_id: null}`，Job 新增字段 `payload: object | null`（这里为 `{uid, start}`）→ 返回 Job。
- 请求体 `{start}`（必填，那一次在 `/calendar` 里的 `start`）；重复日程只删那一次，不删系列。agent 按 iCalUID + start 找实例。
- agent 执行：Google Calendar API 删除该事件（**任何事件**，不限 Mojito 建的）；写一条 `kind=log`、`tier=log` 记录"删除了日程：<标题>（<时间>）"，`undo = {"type": "calendar", "op": "delete", "event_id", "before": <原事件>}`；然后 `POST /calendar/refresh`。撤销 = 按 `before` 重建（新 id，不含参会人邀请回复）。
- 对话里要求删除同样走 `calendar_actions` 的 `delete`，不限带标记的事件（改和建仍只动 Mojito 建的）。

## 订阅
**Subscription** `{id, name, kind: "papers" | "mail", at: "HH:MM", enabled: bool, config: object, last_run_at, last_result: str | null, health: "ok"|"warn"|"error"|null}`

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/subscriptions` | app / agent / worker | `{subscriptions}` |
| POST | `/subscriptions/{id}/enabled` | app / agent / worker | `{enabled}` → Subscription；写改动记录带撤销（`undo.type = "subscription"`） |
| PUT | `/subscriptions/{id}` | agent / worker | `{at, config}`（对话里改时间）；写改动记录带撤销 |
| POST | `/subscriptions/{id}/result` | worker | `{result, health}`：每次跑完报；hub 写 `last_run_at`，health 变化规则同数据源健康 |

- 初始（hub 建库时写入）：`papers` 07:00 开，config `{}`；`mail` 07:30 开，config `{}`。
- hub 按各订阅的 `at`（配置时区）每天入队：`feed_papers`、`feed_mail`（runner=mac）；`enabled=false` 不入队。`feed-papers` 数据源健康照旧，另由订阅 result 反映。
- agent / worker 对话输出新增 `subscription_updates: [{id, changes: {at?, enabled?, config?}}]`。

## 每日邮件（worker）
- Gmail 只读取过去 24 小时收件；脚本取发件人/主题/摘要片段，`claude -p` 挑值得看的（≤8 封），写一张卡：`kind="mail"`（Card.kind 新增 `mail`），`origin="gmail"`，标题"今日邮件：N 封值得看"，`summary` 每封一行"发件人 · 主题 —— 一句话（为什么要看）[打开](https://mail.google.com/mail/u/0/#inbox/<message id>)"，`dedupe_key` = 配置时区的日期。**正文不发给 hub。** 没有值得看的也写一张"今天没有要紧邮件"。

## 帖子类卡片（给插件用）
- Card.kind 新增 `post`：`title` 帖子标题，`summary` "作者 · 赞 N —— 为什么推给你"，`link` 帖子网址，`dedupe_key` 帖子 id，`origin` 由插件自定（如 `<平台>:<关键词>`）。
- 封面：插件下载封面，按对话图片规则压缩（长边 ≤800px）后 `POST /attachments`（**放开 worker**），卡片新字段 `image_attachment_id: str | null`（`POST /cards` 请求体加该字段，可选，不给即 null）。
- 公开版不自带发帖子卡片的插件；订阅 `kind` 目前只有 `papers`、`mail`。

---

# 推送去重、笔记图片、通知设置（design 8.6）

## 推送去重（修"每条弹两条"）
- FCM data 的 `title` 键改名 `headline`（其余不变：`{record_id, item_id, headline, tier, kind, reply}`）。原因：expo-notifications 见到 data.title 会自己再弹一条。上线顺序：app 先空中更新（同时认 `title` 和 `headline`），hub 后部署；hub 上线后 app 去掉 `title` 兼容。

## 笔记带图片
- `POST /records` 请求体加 `attachment_ids`（可选，不给即空列表；规则同 `POST /chat`：最多 4 张、不能引用已被其他消息用过的附件）；`body` 可为空串但此时 `attachment_ids` 不能为空，`title` 写"[图片]"。
- worker 的 `process_note` 取图，按"Claude 怎么看图"的方式一起交给 Claude。

## 通知设置
- `Settings` 新增 `notify: {brief, chat, alert, feedback, release, jobs}`（全 bool）；`PUT /settings` 里 `notify` 可选（不给即不改）。迁移时补全为全 true。
- Record 新增 `category`：`brief | chat | alert | feedback | release | jobs | null`（只对会推送的 tier 有意义）。`POST /events` 请求体加 `category`（可选）；不给时 hub 推断：`tier=interrupt` → alert；`source=maintainer` 或反馈状态记录 → feedback；`source=cards` 且标题以"app 已更新""服务器已更新""新安装包"开头 → release；`kind=chat` → chat；hub 自己写的任务完成 / 失败 → jobs；其余 → jobs。agent 写早上简报、晚间提问时传 `category="brief"`。
- hub 推送前查 `settings.notify[category]`，为 false 就不推（记录照写）。`/pulse` 的 records 带 `category`，Mac 按同一设置过滤通知。

---

# 对话能做的事（design 8.7）

- `POST /worker/jobs`（agent / worker）允许的 `kind` 扩为：`chat_reply`、`refresh`、`sync_projects`、`draft_review`、`feed_papers`、`feed_mail`（`runner` 按任务固定：除 chat_reply 外都是 `mac`；`record_id` 为 null；同 kind 已有 queued / running 时返回那一个，不重复入队）。
- agent / worker 对话输出新增 `run_jobs: [kind]`（上面除 chat_reply 外的 kind），脚本逐个 `POST /worker/jobs`，回复里说"已开始"。
- `POST /subscriptions/{id}/run`（app / agent / worker）→ 入队该订阅对应的 feed 任务（同上去重）→ Job。订阅页"现在跑"按钮用它。
- 提示词硬规则：回复里不写文件路径、代码/函数名、内部 id、英文字段名；允许 Markdown 的粗体、列表、链接。

---

# iPhone 网页版（PWA）与 Web Push（见 design.md 8.8）

这一节只新增静态路径、接口、表、环境变量，以及两个使用记录动作。FCM data 的格式、`/devices`、`/pulse`、`/today` 一概不变。

## 公开静态路径 `/app/`

| 方法 | 路径 | 令牌 | 内容 |
|---|---|---|---|
| GET | `/app` | 无 | 跳到 `/app/`（框架自带的 307） |
| GET | `/app/{path}` | 无 | 网页构建，也就是 mobile 的 `build:pwa` 产物；目录取 `MOJITO_WEB_DIR` |

**返回规则**
- 文件存在：原样返回。
- 文件不存在、路径最后一段没有扩展名：返回 `index.html`，交给客户端路由，例如 `/app/open`、`/app/items/x`。
- 文件不存在、但有扩展名：返回 404。
- 路径解析后跑出了目录：返回 404。不列目录。
- `MOJITO_WEB_DIR` 是软链接，每次请求都重新解析。切换版本后立即生效，不用重启 hub。

**缓存**
- `/app/_expo/static/**`：`Cache-Control: public, max-age=31536000, immutable`。
- 其余文件：`no-cache`，靠 ETag 返回 304。

**响应头**
- `/app/**` 的所有响应都带：
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
  - `Referrer-Policy: no-referrer`
- hub 的**所有**响应（包括 API）都带 `X-Content-Type-Options: nosniff`。

**压缩与类型**
- 只对 `/app/` 下的响应压缩：请求带 `Accept-Encoding: gzip`、且响应 ≥ 1 KB 时 gzip。API 响应不变。
- `.webmanifest` 返回 `application/manifest+json`，`.js` 返回 `text/javascript`。

**内容约束**（发布脚本逐条检查）
- **构建里不能有：**
  - 令牌或 hub 数据；
  - `EXPO_PUBLIC_*` 变量；
  - source map（`*.map` 或 `sourceMappingURL`）；
  - EAS projectId、`u.expo.dev` 更新地址、Expo owner。
- **文件类型：** 只允许这些扩展名：html、js、css、json、webmanifest、png、ico、ttf、woff2。
- **同源下 hub 不返回的东西：**
  - 永远不返回用户可控的 HTML、JS 或 SVG；
  - 附件只收 JPEG，而且下载要令牌。
- **认证方式：** 不用 cookie 认证，不加 CORS。
- **令牌不进网址：** 永远不支持用 `?token=` 或 URL 片段传令牌，否则令牌会进浏览器历史、访问日志和 Referer。

**构建产物里的固定文件**（app 和 hub 共同遵守）

| 路径 | 内容 |
|---|---|
| `/app/manifest.webmanifest` | `id`、`start_url`、`scope` 都是 `/app/`；`display: standalone`；`name` 和 `short_name` 是 app 名称；`lang: zh-CN` |
| `/app/pwa-boot.js` | 同步加载，先于主包执行。它会设 `window.__MOJITO_PWA__ = {build}`；再按 localStorage 的 `mojito.colorScheme`（没有就按系统深浅色）写 `theme-color` 和页面底色 |
| `/app/sw.js` | Service Worker，scope 为 `/app/`，约定见下 |
| `/app/version.json` | `{"build": "<git sha 前 12 位>", "built_at": "<ISO-8601>"}` |
| `/app/open?record_id=&kind=&item_id=` | 客户端路由，点通知时打开。app 按 `routeOf` 跳转，并记一条 view `push_open`。没有 `item_id` 时这个参数不出现。这个页面**不改任何状态**，因为任何人都能构造这个链接 |

**`sw.js` 约定**
- **注册**：`{scope: '/app/', updateViaCache: 'none'}`。
- **install**
  - 预缓存本版本的 `/app/`（index.html）、`pwa-boot.js`，以及构建时写进去的 `_expo/static/**` 和 `assets/**` 清单。
  - 缓存名是 `mojito-<build>`。
  - 然后调用 `skipWaiting()`。
- **activate**：删掉其他 `mojito-*` 缓存，然后调用 `clients.claim()`。
- **fetch**
  - 只处理同源、GET、并且 path 以 `/app/` 开头的请求。其余请求一律不调用 `respondWith`，包括所有 API 请求。
    - 注意：SW 能看到它控制的页面发出的所有请求，不只是 `/app/` 下的。所以必须显式放过其他请求。
  - **导航请求和 `pwa-boot.js`**：先走网络。
    - 网络出错、4 秒超时、或返回非 2xx 时，改读缓存。
    - 网络成功、且返回的是 2xx 的 text/html 或 js 时，更新缓存。
  - **`_expo/static/**` 和 `assets/**`**：先读缓存，缓存里没有再走网络。
  - **其他文件**（`version.json`、manifest、icons、`sw.js`）：不拦。
- **push 和 notificationclick**：见下面"推送载荷"。

## Web Push 接口

| 方法 | 路径 | 令牌 | 作用 |
|---|---|---|---|
| GET | `/webpush/vapid-public-key` | app | 返回 `{public_key}`：P-256 公钥，未压缩点 65 字节，base64url 无填充（87 个字符），直接用作 `applicationServerKey` |
| POST | `/webpush/subscriptions` | app | 请求体 `{endpoint, keys: {p256dh, auth}}`，返回 204 |
| POST | `/webpush/subscriptions/delete` | app | 请求体 `{endpoint}`，返回 204。订阅不存在也返回 204（幂等）。endpoint 放在请求体里，不放在 query 里，这样不会进访问日志 |

**登记**
- **记录令牌指纹**：hub 记下调用者令牌的 `token_ref`，也就是 sha256(令牌) 十六进制的前 16 位。令牌本身不存。
- **记录 UA**：记下请求头 `User-Agent`，截到 200 个字符。这个头必须有，缺了返回 422。
- **按 `endpoint` 更新或插入**：重复登记时，更新 keys、`token_ref`、`user_agent`；`registered_at` 保留首次时间。
- **数量上限**：总共最多 20 条订阅。已满时再登记一个新 endpoint，返回 422。

**请求体校验**（不合法返回 422；422 日志不记提交的值）
- **`endpoint`**：用 `urlsplit` 解析，必须同时满足：
  - scheme 是 `https`；
  - 不带 userinfo；
  - 端口为空或 443；
  - hostname 转小写后在白名单里：
    - `push.apple.com` 及其子域；
    - `fcm.googleapis.com`（只精确匹配）；
    - `push.services.mozilla.com` 及其子域；
    - `notify.windows.com` 及其子域。
- **`p256dh`**：做 base64url 解码后必须是 65 字节，且首字节为 `0x04`。
- **`auth`**：做 base64url 解码后必须是 16 字节。
- **多余字段**：app 只发上面这些字段，不发 `expirationTime`。多出的字段按"兼容规则"忽略。

**表**（加进 SCHEMA；已有的库启动时自动建表，`user_version` 不变）

```sql
CREATE TABLE IF NOT EXISTS webpush_subscriptions (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  token_ref TEXT NOT NULL, user_agent TEXT NOT NULL, registered_at TEXT NOT NULL);
```

**启动清理**
- hub 每次启动时，删掉 `token_ref` 不属于任何现有 `app` 令牌的订阅，并记一条 warning（只记条数）。
- 令牌只有在 hub 重启时才会变，所以只在启动时清理就够了。吊销一个令牌后重启 hub，那台设备的推送就停了。

## 推送载荷（Declarative Web Push 格式）

```jsonc
{
  "web_push": 8030,
  "notification": {
    "title": "<分类标签>",                          // 见下表
    "body": "<Record.title>",                       // 也就是 FCM data 里的 headline
    "navigate": "<MOJITO_PUBLIC_URL>/app/open?record_id=<id>&kind=<kind>[&item_id=<id>]",  // 参数做 URL 编码
    "silent": true | false,                         // 只有 tier=quiet 时为 true
    "data": { "record_id", "headline", "tier", "kind", "reply", "item_id"? }
  }
}
```

| category | `brief` | `chat` | `alert` | `feedback` | `release` | `jobs` |
|---|---|---|---|---|---|---|
| 分类标签 | 简报 | 对话 | 告警 | 反馈 | 更新 | 任务 |

- **`data` 和 FCM data 完全相同**：两者都由 `push_data(record)` 生成。值都是字符串，`item_id` 为 null 时不带。
- **不带 `app_badge`**：角标由 app 在打开时设置。hub 也不发只刷新角标的静默推送，每条推送都必须显示成通知。
- **SW 的 `push` 事件**（iOS 18.4+ 收到声明式推送时，这个事件照样会触发）：
  - 有 `event.notification`：说明浏览器已经按声明式格式处理了这条推送。SW **不再** `showNotification`，只给已打开的窗口 postMessage `{type: 'push', record_id}`。
  - 没有 `event.notification`（iOS 16.4–18.3、Chrome、Firefox）：SW 解析同一份 JSON，调用 `showNotification(title, {body, silent, tag: record_id, data: {...data, navigate}})`，同样发 postMessage。
- **SW 的 `notificationclick`**
  - 先关掉通知，再取 `data.navigate`。
  - 地址校验：`new URL(navigate).origin` 必须等于 `self.location.origin`，并且 path 以 `/app/` 开头。不满足时一律改用 `/app/`。
  - 有已打开的窗口：聚焦它，并 postMessage `{type: 'open', url}`。没有窗口：`openWindow(url)`。
- **`reply=true`**：iPhone 上没有内联回复，点开后按 `routeOf` 进对话页。

## 发送规则

**什么时候发**
- 和 FCM 共用同一套过滤：`tier` ∈ {`interrupt`, `digest`, `quiet`}，而且 `settings.notify[category]` 为 true。
- **`push()` 的顺序**：
  1. 过滤；
  2. 启动 FCM 任务；
  3. 查订阅，有订阅就启动 Web Push 任务。
- **异常只进日志**：Web Push 载荷的构造和大小检查都在它自己的任务里做。出错只由任务回调记日志，不影响接口返回，也不影响 FCM。
- 两个通道的日志分开记：`FCM push failed` 和 `Web Push failed`。
- 没有任何订阅就不发，记录照写。`/pulse` 不受影响。

**编码与加密**
- JSON 按 UTF-8 输出，不转义（`ensure_ascii=False`）。
- 明文不超过 3993 字节（加密后不超过 4096 字节）。超过就这一条不发 Web Push，记 error 日志，不截断。
- 加密用 `aes128gcm`（RFC 8291）。
- **VAPID JWT**（RFC 8292）
  - 字段：`aud` 是 endpoint 的 origin，`sub` 取 `MOJITO_VAPID_SUBJECT`，`exp` 是签发时间加 12 小时。
  - 按 `aud` 缓存，剩余有效期不足 1 小时时重签。

**请求**
- 请求头：
  - `TTL: 86400`；
  - `Urgency`：interrupt 用 `high`，digest 用 `normal`，quiet 用 `low`；
  - 不带 `Topic`；
  - `Content-Encoding: aes128gcm`；
  - `Authorization: vapid t=<jwt>,k=<public_key>`。
- 单个请求超时 10 秒。不跟随重定向，3xx 按错误处理。
- **线程**：Web Push 用自己的单线程执行器，不占默认线程池，所以不会拖慢 FCM、附件和日历。订阅逐个发送，一个出错不影响其他订阅。

**结果处理**

| 推送服务的响应 | hub 的处理 |
|---|---|
| 2xx | 成功 |
| 404 / 410 | 订阅已失效，删掉这一行，记一条 warning（只记条数） |
| 3xx、400、401、403、413、429、5xx、网络错误 | 保留订阅，记 error 日志（推送服务的 host、状态码、Retry-After，不记 endpoint 全文），不重试 |

401 和 403 通常是 VAPID 配置问题，不自动删订阅。

## app 端约定

**判断条件**
- 页面上有 `window.__MOJITO_PWA__`，就是网页版。这个变量只由 `/app/` 构建里的 `pwa-boot.js` 设置。
- 所有 PWA 行为都用 `pwa !== null` 判断，**不用** `Platform.OS === 'web'`，因为 Mac 也是 web。
- Mac（Tauri）和安卓的行为一律不变。

**安装说明页**
- 是 iOS 设备、而且不在 standalone 模式时，只显示安装说明。
  - iOS 设备的判断：UA 含 `iPhone|iPad`，或者含 `Macintosh` 且 `navigator.maxTouchPoints > 1`。
  - standalone 的判断：`matchMedia('(display-mode: standalone)')` 或 `navigator.standalone`。
- 其他平台在标签页里也能填令牌、开推送。说明里另写一段安卓的装法：菜单 → 安装应用。

**hub 地址和令牌**
- hub 地址固定取 `location.origin`，不存储。
- 令牌存在 localStorage 的 `mojito.token`。保存令牌后调用 `navigator.storage.persist()`。

**开启推送**
- 按钮要等 `serviceWorker.ready` 就绪、VAPID 公钥取到之后才可点。
- 点击处理函数的第一句要**同步**调用 `reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`，在它之前不能有任何 `await`。
- 订阅成功后调用 `POST /webpush/subscriptions`，并上报 `push_enable`。

**每次启动**
- 先判断 `'Notification' in window && 'PushManager' in window`，再判断权限是否为 `granted`。
- 条件满足时，取 `getSubscription()`，把它的 key 和 VAPID 公钥比较：
  - 一致：重新 POST 一次（接口幂等）。iOS 没有 `pushsubscriptionchange` 事件，靠这一步兜住订阅变化。
  - 不一致或订阅为空：显示"重新开启推送"按钮，需要用户点一下。

**关闭推送或清除令牌**
- 先 `unsubscribe()`，再调用 `POST /webpush/subscriptions/delete`，然后上报 `push_disable`。

**角标**
- 每次取到 `/today` 后，如果通知权限为 `granted`、而且有 `setAppBadge` 这个接口，就用等你拍板总数设角标。数量为 0 时清除。

**前台行为**
- **切回前台时**：
  - `fetch('/app/version.json', {cache: 'no-store'})`，和 `__MOJITO_PWA__.build` 比较。不一致就显示"有新版本 · 点此刷新"横幅，同时调用 `reg.update()`。
  - 如果有上次看过之后新来的推送类记录，顶部显示"刚收到：<标题>"，点一下按 `routeOf` 跳过去。
- **页面可见期间**：每 30 秒调一次 `/pulse`，游标规则和 Mac 相同。
- **收到 SW 的 `push` 消息时**：立即刷新 `/today`。

**其他**
- 反馈的 `context.app_update_id` 填 `web:<build>`。
- 新页面（安装引导页、`/open`）不新增 view 名。`/open` 只上报 `push_open`。

## 使用记录

- action 新增 `push_enable`、`push_disable`，`detail` 为 null。
- view `push_open` 复用：网页版从通知打开时同样上报。
- 这两个是新的枚举值，所以 hub 必须先部署。

## app 令牌可以有多个

- 令牌文件里可以有多个角色为 `app` 的令牌。每台装网页版的设备用自己的那个。
- 新增用 `hub/deploy/add-app-token.sh`，吊销用 `hub/deploy/revoke-token.sh <token_ref>`。两个脚本都会重启 hub。
- 吊销一个令牌后，hub 在启动清理时删掉它的推送订阅。

## hub 环境变量（这一节新增，全部必填，缺一个或格式不对就启动失败）

- **`MOJITO_VAPID_KEY_FILE`**
  - VAPID 私钥 PEM 文件的路径（参考部署 `/var/lib/mojito/vapid.pem`），属主为 hub 的服务用户，权限 600。
  - 私钥必须是 P-256（openssl `ecparam` 生成的 SEC1 PEM）。hub 启动时读取并算出公钥。
- **`MOJITO_VAPID_SUBJECT`**：必须以 `mailto:` 或 `https://` 开头。
- **`MOJITO_PUBLIC_URL`**
  - hub 的公开地址，以 `https://` 开头，不带路径，结尾不带斜杠。
  - 只用来拼接 `navigate`。
- **`MOJITO_WEB_DIR`**
  - 网页构建目录，是一个软链接（参考部署 `/opt/mojito-web/current`）。
  - hub 启动时这个目录必须存在。

另外：
- **令牌强度**：`MOJITO_TOKENS` 里每个令牌都至少 32 个字符，而且只含 `A-Za-z0-9_-`，否则启动失败。
- 新增依赖只有 `py-vapid` 和 `http-ece`，两者都只依赖已有的 `cryptography`。

## 部署布局

- **目录**
  - 网页构建放在 `/opt/mojito-web/releases/<sha12>/`，`current` 是指向当前版本的软链接。
  - 目录属 root，权限 755，hub 只读。
  - **不能放在 `/opt/mojito` 里**，因为 `deploy.sh` 会在那里执行 `git clean -fdx`。
- **发布命令**：`hub/deploy/deploy-web.sh <ref> "<说明>"`。
  - 构建在本机做（`expo export` 要 4GB 以上内存）：在临时目录里 `git archive <sha> mobile`，然后按 lockfile `npm ci`，再执行 `build:pwa`。服务器不构建。
  - 新版本要保留上一版的 `_expo/static` 文件。
  - 切换软链接后立刻生效，不重启 hub。
  - 保留最近 3 个版本。
- **"每次更新都推送通知"表里加一行**：`deploy-web.sh` 成功后推送。
  - 发送方：infra 的 deploy-web 脚本。
  - 标题："网页版已更新：<一句话>"。
  - 正文："改了什么；iPhone 上回到 app 时会提示刷新"。
  - `POST /events` 时显式带 `category="release"`，因为推断规则只认已有的那几个标题前缀。
- **"公开页面"一节**：hub 提供不需要令牌的静态内容：`/`、`/privacy` 两页，以及 `/app/` 网页版（不含任何数据）；其余接口仍全部要令牌。

---

# 界面语言（design.md 8.9）

- `Settings` 新增 `language: "zh" | "en"`；`PUT /settings` 里可选（不给即不改）；迁移时已有设置补 `"zh"`；新库按种子文件里 `settings.language` 写，缺了报错。
- hub 自己写给用户看的文字（反馈"已修复：/没改："、任务完成/失败、数据源/订阅/授权告警、改动记录"从 X 改成 Y"、推送分类标签）按 `settings.language` 出中文或英文；已写入的旧记录不改。
- agent / worker：每次任务先 `GET /settings`，所有写给用户的文字（对话回复、简报、晚间提问、卡片 summary、事项 next_step、草稿）用该语言；提示词里"写给用户看的文字"规则同样适用于英文（不写路径、代码名、内部 id、字段名）。
- 发布脚本（update.mjs、build-apk、deploy.sh、deploy-web.sh、desktop release）推送的标题前缀跟随各自配置里的语言（必填参数或环境变量，缺了报错），`POST /events` 显式带 `category: "release"`。

### 补充（回答 hub 的问题）
1. 晚间提问的固定标题：中文"今天推进了什么？"，英文 "What did you move forward today?"；`/metrics.evening_asked` 两种都认。
2. 订阅名称按 `kind` 由 hub 按语言输出（papers → 论文 / Papers，mail → 每日邮件 / Daily mail），不用库里存的名字显示。
3. 界面英文用词以 agent 的词表为准（Your call、Focus、Overdue、Gone quiet、Plan、Projects、Feed、Notes、Chat；In progress / Waiting on you / Scheduled / Ongoing / Done / Closed；Me / Auto / Auto, then me；计划 Draft / In progress / Ended），mobile、hub、agent、worker 一致。

---

# 附：环境变量汇总

全部必填，缺一个就启动失败（不写默认值）。令牌、私钥、OAuth 文件永不入库。

**hub**（服务器，`/var/lib/mojito/env` 之类的 env 文件）

| 变量 | 说明 |
|---|---|
| `MOJITO_DB` | SQLite 文件路径 |
| `MOJITO_TOKENS` | 令牌文件路径（JSON：令牌 → 角色） |
| `MOJITO_SEED` | 种子文件路径（数据库里没有 Goal 时导入） |
| `MOJITO_TIMEZONE` | 配置时区，IANA 名 |
| `MOJITO_ATTACHMENTS_DIR` | 图片附件目录 |
| `MOJITO_ICAL_URL` | 日历私密 iCal 链接（当令牌保管） |
| `MOJITO_FCM_CREDENTIALS` | Firebase 服务账号 JSON 路径 |
| `MOJITO_VAPID_KEY_FILE` | VAPID 私钥 PEM 路径 |
| `MOJITO_VAPID_SUBJECT` | `mailto:…` 或 `https://…` |
| `MOJITO_PUBLIC_URL` | hub 的公开 HTTPS 地址 |
| `MOJITO_WEB_DIR` | 网页构建目录（软链接） |
| `MOJITO_OWNER_NAME` | 公开页面上写的运行者名字 |
| `MOJITO_CONTACT_EMAIL` | 公开页面上的联系邮箱 |

**agent**（服务器，`agent.env`）：`MOJITO_HUB_URL`、`MOJITO_AGENT_TOKEN`、`MOJITO_CLAUDE_BIN`、`MOJITO_GOOGLE_OAUTH`、`MOJITO_TIMEZONE`；Claude 凭据 `ANTHROPIC_API_KEY` 或 `CLAUDE_CODE_OAUTH_TOKEN` 二选一。

**worker**（本机，`worker/.env`）：

| 变量 | 说明 |
|---|---|
| `MOJITO_HUB_URL` | hub 地址 |
| `MOJITO_WORKER_TOKEN` | worker 令牌 |
| `MOJITO_CLAUDE_BIN` | `claude` 的绝对路径 |
| `MOJITO_TIMEZONE` | 配置时区，和 hub 相同 |
| `MOJITO_PROJECTS_ROOT` | 本地 git 仓库的根目录（只读） |
| `MOJITO_GMAIL_OAUTH_FILE` | Gmail 只读授权文件 |
| `MOJITO_ZOTERO_DB` | `zotero.sqlite` 路径，或 `none` |
| `MOJITO_ARXIV_CATEGORIES` | 论文订阅的 arXiv 分类，逗号分隔 |

**本机其他**（`~/.config/mojito/secrets/`）：`maintainer.env`（`MOJITO_HUB_URL`、`MOJITO_MAINTAINER_TOKEN`，维护会话用）、`cards.env`（`MOJITO_HUB_URL`、`MOJITO_CARDS_TOKEN`，`mojito-card` 和发布脚本用）。
