# mojito agent（服务器上的轻量 agent，v2a）

服务器上的常驻小循环：心跳 → 领 `runner=server` 的任务 → 处理 → finish，一次一个。判断用 `claude -p --json-schema`，每次单次调用、不给工具、跑完即退；动作由脚本执行。输入统一走 `--input-format stream-json`（要求 `--output-format stream-json --verbose`，结果取最后一条 `type=result` 事件），这样对话里的图片能以 base64 image block 随消息传给 Claude，不落盘。约定见 `../docs/api.md`「v2a 追加」和 `../docs/design.md` 第 9 节。

## 配置（环境变量，全部必填，缺一个就退出）

| 变量 | 说明 |
|---|---|
| `MOJITO_HUB_URL` | 和 hub 同机时为 `http://127.0.0.1:8787` |
| `MOJITO_AGENT_TOKEN` | hub 里角色为 `agent` 的令牌 |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` 生成；只由 `claude -p` 继承使用 |
| `MOJITO_CLAUDE_BIN` | `claude` 可执行文件绝对路径 |
| `MOJITO_GOOGLE_OAUTH` | google-auth 的 authorized-user JSON（`creds.to_json()`），用 `Credentials.from_authorized_user_file` 读、只请求 `calendar.events`；每个用到日历的任务换一次 access token，不写回文件 |
| `MOJITO_TIMEZONE` | 用户所在的 IANA 时区（如 `Europe/Berlin`），必须和 hub 的 `MOJITO_TIMEZONE` 相同；日程、提示词里的"今天"和时间都按它算 |

固定项在 `src/mojito_agent/config.py`：心跳源 `server-agent`、`expected_interval_s=300`、空闲轮询 10 秒、`claude -p` 超时 240 秒（必须小于心跳间隔）、授权检查每小时一次。

## 授权状态与停止

- `google-calendar-write`：启动时和每小时换一次 access token → `PUT /auth-status/google-calendar-write`；失败的 `detail` 是 OAuth 错误码（如 `invalid_grant`），不含令牌。网络不通不算失败，下轮再试。
- `claude-server`：`claude -p` 返回 401/403 → 报 `false`（`detail=authentication_error`），之后第一次成功 → 报 `true`；只在状态变化时报。
- SIGTERM（`systemctl stop`）：空闲时退出码 0；正在跑任务时一起结束当前 `claude -p` 子进程、不 finish，hub 看门狗 30 分钟后把任务置回 `queued`。

## 任务

| kind | 做什么 |
|---|---|
| `chat_reply` | 上下文：系统状态（数据源、授权）、消息（含图片；问问这个的卡片带 `body` 全文）、最近对话、维护会话最近的消息、今天（含今天页规则）、目标、项目、当前与草稿计划、未完成的事项、最近笔记、口味档案、最近 10 张卡片（报告卡带三行要点）、最新一期每日 AI 简报全文、7 天日历、mojito 建的日程。Claude 输出（`CHAT_OUTPUTS`）后脚本校验再执行：**直接改**（hub 写"从 X 改成 Y"记录和撤销）`item_updates`、`goal_updates`、`plan_updates`、`project_updates`、`settings_update`、`card_actions`、`note_links`、`taste_notes`、`subscription_updates`（订阅的时间、开关；实验室动态的 `labs`、`every_hours`）；`run_jobs`（立刻跑 refresh / sync_projects / draft_review / feed_brief / feed_watch / feed_mail → `POST /worker/jobs`，runner=mac）；`new_items` 直接建成进行中；`calendar_actions`（agent 自己写带 `undo` 的记录）；**只起草**进"等你拍板"：`drafts`（对外发送）、`plan_changes`（Claude 主动建议的计划修订）；`feedback` → `POST /feedback`（带原消息图片），`feedback_reply` → `POST /feedback/{id}/messages`；`forward_to_mac` → 转 Mac。每条对话的非空输出记一行日志。回复写给用户看的文字遵守 `USER_TEXT_RULES`。多行文字（`reply`、草稿 `body`、早上简报 `body`）让 Claude 按行给字符串数组（`LINES_SCHEMA`），脚本用换行拼接，避免模型把换行多转义成字面 `\n`。实现在 `jobs.py`、`edits.py` |
| `morning_brief` | `/today` 里日程、重点、未读告警、待确认全空且没有项目 summary 就不发；否则 Claude 写简报（今日重点 = `/today.focus`，按项目归类、带"还有 N 天"；逾期和被忘了分开说；有今天的每日 AI 简报卡时末尾一句简报要点），`kind=chat tier=digest` |
| `calendar_delete` | `payload {uid, start}` → Google 按 iCalUID + start 找到那一次事件并删除（任何日程，不限 mojito 建的；重复日程只删这一次）→ 写 `kind=log` 记录"删除了日程：…"带 `undo`（op=delete，before=原事件）→ `POST /calendar/refresh` |
| `undo` | 读记录的 `undo`：create → 删掉该事件；update → 用 `undo.before` 改回；delete → 按 `undo.before` 重建（新 event_id）。只动带 `extendedProperties.private.mojito=1` 的事件；写一条 `kind=log` 的"已撤销"记录，再 `POST /calendar/refresh` |
| `evening_prompt` | 纯规则，不调 Claude：`evening_enabled=false` → 不发；今天已问过、或已发过"还要继续吗"且之后没回 → 不发（白天记过东西也照样问）；最近 3 次提问之后一直没有 `author=me` 记录 → 发「晚间提问还要继续吗？」；否则发「今天推进了什么？」（`tier=digest`） |

界面语言：每个任务先 `GET /settings`，Claude 写的和脚本写的给用户看的文字都用 `settings.language`（`zh` / `en`）；脚本的固定文案在 `src/mojito_agent/texts.py`（两种语言键必须一致，缺翻译导入即报错）。晚间提问按两种语言的标题识别旧提问。

所有 `POST /events` 都带 `project_id` 和 `repo_path=null`（以及 `undo`）。hub 调用遇 502/503/504、连接错误时按 1/2/4/8/15 秒退避重试（hub 部署重启期间不判失败）。任务出错 → `finish failed` 带原因，进程继续；hub 连不上只记日志、下轮重试。

## 运行

```
cd agent && uv sync
MOJITO_HUB_URL=... MOJITO_AGENT_TOKEN=... CLAUDE_CODE_OAUTH_TOKEN=... MOJITO_CLAUDE_BIN=... MOJITO_GOOGLE_OAUTH=... MOJITO_TIMEZONE=... uv run mojito-agent
```

agent 建的事件带 `extendedProperties.private.mojito="1"`，描述末尾一行"由 mojito 创建"（`src/mojito_agent/gcal.py`）。

Mac 上本地测试没有 setup-token 时，让 `MOJITO_CLAUDE_BIN` 指向一个先 `unset CLAUDE_CODE_OAUTH_TOKEN` 再 `exec <claude 的绝对路径> "$@"` 的包装脚本，走本机登录态。

部署见 `deploy/README.md`（systemd `mojito-agent`，`MemoryMax=450M`、`OOMScoreAdjust=900`）。
