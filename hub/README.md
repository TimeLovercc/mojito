# mojito hub

FastAPI + SQLite。接口约定见 `../docs/api.md`（唯一权威）。

## 启动

```sh
cd hub
uv sync
uv run uvicorn mojito_hub.main:app --host 127.0.0.1 --port 8787
```

单进程（不要加 `--workers`）：看门狗是进程内后台任务，SQLite 由一个连接独占。

## 环境变量（全部必填，缺一个启动即失败）

| 变量 | 含义 |
|---|---|
| `MOJITO_DB` | SQLite 文件路径（不存在会自动建表） |
| `MOJITO_TOKENS` | 令牌文件（每个令牌 ≥32 个字符，只含 `A-Za-z0-9_-`；可有多个 app 令牌），JSON：`{"<token>": "app" \| "worker" \| "source:<name>"}` |
| `MOJITO_SEED` | 种子文件，库里没有 Goal 时导入；`docs/seed.example.json` 是虚构的示例数据（`examples/demo/demo_data.py` 生成），换成你自己的请放在仓库外 |
| `MOJITO_ICAL_URL` | Google Calendar 私密 iCal 链接（当令牌保管，不入库） |
| `MOJITO_FCM_CREDENTIALS` | Firebase 服务账号 JSON 路径（FCM HTTP v1；推送只走 FCM，没有登记设备就不发，记录照写） |
| `MOJITO_ATTACHMENTS_DIR` | 对话图片目录（必须已存在，服务用户可写）；文件为 `<id>.jpg`、权限 600，数据库只存元数据 |
| `MOJITO_VAPID_KEY_FILE` | Web Push 的 VAPID 私钥（P-256 SEC1 PEM，`openssl ecparam -name prime256v1 -genkey -noout`）；不存在不会自动生成，直接启动失败 |
| `MOJITO_VAPID_SUBJECT` | `mailto:` 或 `https://` 开头 |
| `MOJITO_PUBLIC_URL` | hub 公开地址 `https://<host>`（无路径、无结尾斜杠），只用来拼通知的跳转链接 |
| `MOJITO_WEB_DIR` | 网页版构建目录（软链接 `…/current`，每次请求重新解析，切版本不用重启） |
| `MOJITO_TIMEZONE` | 你所在的 IANA 时区（如 `Europe/Berlin`）；按天的判断、早晚提醒、订阅时间、通知里的短时间都按它算；agent、worker、app 必须用同一个 |
| `MOJITO_OWNER_NAME` | 公开页 `/`、`/privacy` 上写的运行者名字（一个词，不含空格） |
| `MOJITO_CONTACT_EMAIL` | 公开页 `/`、`/privacy` 上的联系邮箱 |

服务器上的完整示例见 `deploy/server.env.example`。

## 行为

- 看门狗每 60 秒：数据源失联写一条 `interrupt`（下次心跳前不重复）；`running` 超 30 分钟的任务回到 `queued`；`end` 已过（按 `MOJITO_TIMEZONE` 的日期）的 `active` 计划置 `closed`。启动时先跑一次。看门狗崩溃则进程退出（交给 systemd 重启）。
- 看门狗同一轮里按设置时间（`MOJITO_TIMEZONE`）入队 `morning_brief` / `evening_prompt`（runner=server；`evening_enabled=false` 时不入队晚间）：只在到点后 10 分钟内入队，每天每种一次（`schedule_runs` 表），停机错过的不补发。
- 另外按本地时间入队：每周日 20:00 `weekly_summary`（mac）；active 计划 `end` 当天的 `evening_at` 入队 `draft_review`（mac）并写 interrupt "该复盘了"（已有复盘草稿则只提醒，已 done 则跳过）。
- 批准新计划前，`end` 早于其 `start` 的已运行计划（非 draft）复盘必须是 `done`，否则 409。
- 通知分类：推送级记录带 `category`（brief/chat/alert/feedback/release/jobs，`/events` 可指定，否则按 api.md 规则推断）；`settings.notify` 某类为 false 时不推（记录照写）。
- FCM：只发 data 消息 `{record_id, item_id?, headline, tier, kind, reply}`（值都是字符串，`item_id` 为 null 时省略；`reply=true` 表示 agent 的对话消息）。FCM 报 UNREGISTERED 的设备令牌自动删除。
- 项目：`last_activity_at` 取该项目记录与快照内活动（worktree 活动时间、commit 时间）中最新的，快照的 `taken_at` 不算；`stale`、`open_items` 读时计算。带 `item_id` 的记录继承事项的 `project_id`；`/events` 在 `project_id` 为 null 时按 `repo_path` 匹配项目。看门狗每 30 分钟入队一次 `sync_projects`（mac，已有排队/运行中的就不入队）。启动时 projects 表为空就导入种子的 `projects` 并按 `item_projects` 回填事项和这些事项的旧记录。
- 使用记录：`POST /usage` 的 (kind, name) 必须在 `models.py` 的 `USAGE_VIEWS` / `USAGE_ACTIONS` 里，否则整批 422；`/usage/summary` 按本地日期统计，`unused` 取这两张表里计数为 0 的名字。
- 授权状态：`google-calendar-write`、`claude-server` 由 agent 报，`gmail-read`、`claude-mac` 由 worker 报；ok 翻转时才写记录（失效 interrupt、恢复 digest），从未上报过视为 ok。
- 日历：每 15 分钟拉取 iCal，展开重复事件，保留过去 1 天到未来 14 天；成功即 `google-calendar` 心跳。拉取失败只记日志，由看门狗的失联告警暴露。
- 启动时就地迁移旧库（如 `jobs.runner` 列，旧任务记为 `mac`）；settings 表为空时从种子的 `settings` 导入（与 Goal 种子独立）。
- 对话图片：`POST /attachments` 只收 `image/jpeg` 且 ≤5MB，宽高从 JPEG 帧头读（不依赖图像库）；一张图只能挂一条对话消息，`POST /chat` 最多 4 张，正文为空时标题为"[图片]"。
- 信息流卡片：`(origin, dedupe_key)` 唯一，重复 409；`source:cards` 令牌和 worker 可发。卡片转事项时写一条带 `card_id` 的待处理笔记；worker 在跑这条笔记的 process_note 时新建的事项会回填到卡片的 `item_id`。订阅（`subscriptions` 表，初始 论文 07:00 / 每日邮件 07:30）按各自 `at`（本地）每天入队 `feed_papers` / `feed_mail`（mac，关掉的不入队；`feed_arxiv` 已作废），周日 20:00 另入队 `feed_weekly`；改开关、时间、设置写改动记录带 `undo.type=subscription`，worker 跑完报 result/health（规则同数据源健康）。删日程：`POST /calendar/{uid}/delete {start}` 只删那一次（uid+start 须在缓存的日历里），入队带 `payload={uid, start}` 的 `calendar_delete`（server）。卡片 kind 加 mail、post（带封面的帖子类内容，给自己接的数据源用），可带 `image_attachment_id`（worker 可上传附件）。口味笔记 `/taste`：agent/worker 写，app/agent 可停用（停用后不再列出）。
- 事项改动：每次 `PUT /items`、拍板、撤销都会把改了的字段记进 `item_changes`。agent/worker 改已有事项、以及拍板 done/close/reopen 时，hub 自己写一条"<事项>：<字段> 从 X 改成 Y"记录（只看 title/status/next_step/next_at/owner/project_id），带 `undo.type=item`，并记下当时的改动序号；撤销时若同一字段之后又改过 → 409，否则 hub 直接恢复 `before` 并返回已 done 的 undo 任务。`/events` 只接受 calendar 撤销。
- 目标/计划/项目/设置/笔记归属：agent/worker 可 `PUT /goals/{id}`、`PUT /plans/{id}`（active 或 draft）、`PUT /projects/{id}`（新建仍只能 proposed），app/agent 改 `PUT /settings`，app/agent/worker 用 `POST /records/{id}/link` 改自己笔记的归属。改已有对象时 hub 写中文"从 X 改成 Y"记录，带 `undo.type` = goal/plan/project/settings/note，由 hub 直接撤销；改动历史记在 `entity_changes`（项目拍板也记），同一字段之后又改过 → 409。
- 笔记整理：worker 在跑 process_note 时新建的事项，hub 自动写"由笔记记成事项：<标题>"记录，带 `undo.type=item_create`（撤销 = 事项 closed + 解除挂在它上面的笔记的 item_id）。`POST /records/{id}/hide` 隐藏自己的笔记（`hidden_at`），`/records`、事项/项目详情默认不返回，`include_hidden=true` 才返回。
- 计划修订版：`POST /plans` 带 `revises`（只能修订 active 计划，期间必须相同）；批准修订版会关闭原计划，原计划不要求复盘（由修订版复盘）。
- 一次性数据迁移记在 `PRAGMA user_version`（1：使用记录里旧的 view `feed` 改名 `timeline`）。
- 请求体里不认识的字段一律忽略，记一行 warning（方法 + 路径 + 字段名 + 模型名，不记值）；缺必填字段仍 422（api.md 兼容规则）。
- 反馈：`maintainer` 令牌可读 app 组全部 GET，并能 `PUT /feedback/{id}`；反馈的截图挂在它那条 `kind=feedback` 记录上。状态变为 shipped/declined 时写 digest 记录并推送（summary 必填）；`awaiting_approval` 进"需要你"。
- hub 写给用户看的文字（记录标题/正文、推送分类标签、撤销被拒原因）按 `settings.language`（zh/en）出中文或英文，词表在 `labels.py`；不带内部 id、字段名和枚举原值。已写入的旧记录不改。
- 立刻跑：`POST /worker/jobs`（agent/worker）只接受 chat_reply 和 refresh/sync_projects/draft_review/feed_papers/feed_mail（后者固定 mac、不带记录，同 kind 已排队或运行中就返回那一个）；`POST /subscriptions/{id}/run` 同样去重。
- Mac app：`GET /pulse?after=&limit=`（app 令牌）按记录序号游标返回之后新写、需推送 tier 的记录，外加 `counts.due_today` / `counts.needs_you`；不给 `after` 只返回当前游标和计数。
- 网页版 `/app/`（无令牌）：文件存在原样返回；无扩展名的缺失路径回 `index.html`；有扩展名缺失或跑出目录 → 404；`_expo/static/**` 永久缓存，其余 `no-cache` + ETag；所有 `/app` 响应带 CSP 和 `Referrer-Policy: no-referrer`，只在这里 gzip；hub 所有响应带 `X-Content-Type-Options: nosniff`。
- Web Push：`/webpush/vapid-public-key`、`/webpush/subscriptions`（登记，记 token_ref 与 UA，最多 20 条）、`/webpush/subscriptions/delete`；启动时删掉已不存在的 app 令牌的订阅。推送与 FCM 同过滤、各自独立的任务；Web Push 在单线程执行器里发（aes128gcm + VAPID，10 秒超时，不跟随重定向），404/410 删订阅。
- 422 会写一条 warning 日志：方法、路径、出错字段位置和错误类型/说明，不记提交的字段值（hub 自己抛的 422 记 detail）。
- 今日重点 v3：`focus` = 进行中（active/waiting_you/scheduled）且 `next_at` 在本地今天的全部，另加今天之后最近的一件，每条带 `days_until`。进行中事项：`next_at` 早于本地今天 00:00 且 7 天内动过 → `overdue`；`next_at` 为空，或过期且 7 天没动 → `forgotten`（Item.forgotten 同）。
- 数据源结果健康：`POST /sources/{name}/health`（该源令牌；worker 另可为 `feed-papers`、`sync-projects` 心跳和报健康；源须先心跳登记）；ok → warn/error 写 digest 并推送，恢复写 log；日历拉取由 hub 自己报。`maintainer` 令牌可发 `maintainer` 心跳，失联阈值 = 2 × expected。
- 指标 `GET /metrics?from=&to=`：每天 app_open 次数、是否发了晚间提问（标题"今天推进了什么？"）、是否在次日 04:00 前回了对话或笔记。
- 时间一律以 UTC ISO-8601 输出。
- OpenAPI：`/openapi.json` 需要 app 令牌；`/docs`、`/redoc` 已关闭。
- 数据库快照：`MOJITO_DB=<库> uv run python -m mojito_hub.snapshot <输出路径>`（只读 `MOJITO_DB`，sqlite backup API 在线生成、完整性检查、600 权限、单文件；失败非 0 退出）。
- 公开页面（不需要令牌，不进 OpenAPI）：`/` 主页、`/privacy` 隐私说明，供 Google OAuth 发布用；运行者和联系邮箱取 `MOJITO_OWNER_NAME`、`MOJITO_CONTACT_EMAIL`。
- 部署与运维（systemd、env、令牌、备份、iPhone 网页版的发布/令牌/VAPID/应急）见 `deploy/README.md`。
