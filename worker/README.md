# mojito worker

Mac 上的长驻工人：轮询 hub 队列，事实用脚本查、判断交给 `claude -p`，结果写回 hub。约定见 `../docs/api.md`。

## 配置

`worker/.env`（不入库；从 `worker/.env.example` 复制），每项都必填，缺一个启动即退出：

| 变量 | 说明 |
|---|---|
| `MOJITO_HUB_URL` | hub 地址，如 `https://<hub-host>.<tailnet>.ts.net` |
| `MOJITO_WORKER_TOKEN` | hub 令牌文件里角色为 `worker` 的令牌 |
| `MOJITO_CLAUDE_BIN` | `claude` 可执行文件绝对路径（`command -v claude`） |
| `MOJITO_TIMEZONE` | 你所在的 IANA 时区，和 hub 的 `MOJITO_TIMEZONE` 相同 |
| `MOJITO_PROJECTS_ROOT` | 本地 git 仓库的根目录（对话只读查询、周总结用） |
| `MOJITO_GMAIL_OAUTH_FILE` | Gmail 只读凭据（`hub/deploy/google-auth.py --scope gmail` 生成）；文件不存在时 `gmail-read` 报未授权、邮件相关功能说"还没接上" |
| `MOJITO_ZOTERO_DB` | `zotero.sqlite` 的路径，或写 `none`（论文口味不参考 Zotero、不做关注作者） |
| `MOJITO_ARXIV_CATEGORIES` | 每日论文的 arXiv 分类，逗号分隔，如 `cs.AI,cs.HC` |

固定项在 `src/mojito_worker/config.py`：轮询 15 秒、心跳 `expected_interval_s=86400`、`claude -p` 超时 600 秒。`claude -p` 一律不给工具（`--tools "" --strict-mcp-config`），查事实、动作都由脚本执行（报告的网页新闻也是脚本抓）。

## 运行

```
cd worker
uv sync
uv run mojito-worker
```

每轮：心跳 `POST /sources/worker/heartbeat` → `POST /worker/lease`（204 就睡 15 秒）→ 按 `kind` 处理 → `finish`。
任务出错 → `finish failed` 并写明原因，进程继续；hub 连不上只记日志、下轮重试。

| kind | 做什么 |
|---|---|
| `process_note` | 每条笔记三选一（`claude -p`）：要办的事 → `PUT /items` 新建进行中事项（id `note-<record_id>`）+ `POST /records/{id}/link` 挂上笔记 + 对话里回"已记成事项：…"（tier=log，撤销记录由 hub 写）；想法/记录 → 只把笔记挂到最相关的项目（或不挂）；看不懂 → 对话里问（tier=digest）。笔记带的图片（`attachments`）同对话一样作为 image block 交给 Claude |
| `refresh` | 读进行中事项及其记录、最近 50 条动态 → `claude -p` 给出有依据的 `next_step`/`next_at` 更新 → `PUT /items` + `POST /events`（`evidence=inferred`） |
| `chat_reply`（`runner=mac`） | 原消息、相关对话、`/today`、挂的事项、本地仓库近 7 天提交 → 最多两轮 `claude -p` 给出查询计划，脚本执行（见下表）→ 一次 `claude -p` 写回复 → `POST /events kind=chat tier=digest`；要回信/发消息时 `PUT /drafts/d-<record_id>-<n>` |
| `draft_review` | 完成/未完成由脚本按事项状态算；`claude -p` 写总结、带依据的跨期规律、下一期草稿 → `PUT /reviews/{plan_id}`、`PUT /items`（`waiting_you`，id `p-<start>-newN`）、`POST /plans`（上期 `end` 次日起 14 天）→ digest 记录"复盘草稿好了"。下一期已存在时只重写复盘 |
| `feed_brief` | 每日 AI 简报（design 8.10）：素材 = 论文（候选：arXiv `MOJITO_ARXIV_CATEGORIES` 最近一个已公布的提交日、HF 每日论文、关注作者；去掉旧论文卡和历次简报里出现过的 arXiv id；口味档案 + 标题粗筛 ≤40 → 读摘要精选 5–10）、网页新闻（脚本搜 Google News RSS 中英两版过去 24 小时：通用 AI 查询 + `labs` 逐家）→ `claude -p`（不带工具）只按素材写各节，引用的链接必须来自素材、同一链接不许引两次（同一件事只写一次，实验室覆盖里已写过的写"见上"），引用的 Google News 链接由脚本解码成原文地址（解不了保留）→ 一张 `kind=brief` 卡（`summary` 3 行、`body` Markdown 分节：新模型发布 / 重要论文 / 开源项目 / 行业新闻 / 趋势解读 / 实验室覆盖，每条一行、链接文字写具体出处（媒体名 / 域名），论文每篇"做了什么"+"和你有关"各一句，没内容写"今天没有"；正文（不含链接地址）超过 4000 字报错；`dedupe_key` = 本地日期；当天已发过就跳过）。任一素材源失败 → 跳过它、health=warn 并写哪个源。发卡后为数据源 `feed-papers` 心跳（93600 秒）并报健康：论文抓取失败 error、筛完 0 篇 warn、其余 ok |
| `feed_watch` | 实验室动态：`labs` 逐家查上次成功运行以来（首次：过去 `every_hours` 小时）的新闻 → `claude -p` 只留实质事件（发布、开源、重要技术报告、争议或安全事件，含传闻 / 泄露 / 曝光）→ 每个事件一张 `kind=alert` 卡（标题前加【传闻】或【确认】，summary 第一行写来源可信度，底部"相关链接"每条写"出处：文章标题"；`origin=watch:<实验室>`，`dedupe_key` = `实验室:事件简称`，确认的加 `:confirmed`）；已报事件键和上次成功时间记在本地 `~/.mojito-worker/watch.json`，同一事件按传闻报一次、确认后再报一次 |
| `feed_mail` | Gmail 只读取过去 24 小时收件（不含已发/草稿）的发件人/主题/摘要片段 → `claude -p` 挑值得看的 ≤8 封 → 一张 `kind=mail` "今日邮件：N 封值得看"卡（每封一行"发件人 · 主题 —— 一句话（为什么要看）[打开](Gmail 链接)"，`dedupe_key` = 本地日期）；没有就写"今天没有要紧邮件"。**邮件正文不发给 hub** |
| `feed_weekly` | 本周简报里的论文（及旧论文卡）→ "本周论文"`kind=report` 卡片（前 3 篇 + 趋势） |
| `sync_projects` | Orca 只读 → 项目快照、新仓库起草为待确认项目；每次 `refresh` 后也跑，并给 active 项目写一句话现状。上报 `sync-projects` 结果健康 |
| `weekly_summary` | 过去 7 天的记录、有更新的事项、本地提交、active 计划 → `claude -p` → `kind=chat tier=digest`"本周总结" |

`feed_brief` / `feed_watch` / `feed_mail` 由 hub 按订阅入队，跑完都 `POST /subscriptions/{id}/result`（`{result, health}`，出错报 error 并让任务失败）；订阅按 `kind` 从 `GET /subscriptions` 找。

其他常驻职责（主循环里顺带做）：
- 维护会话看门狗（`watchdog.py`）：每 5 分钟看 `maintainer` 心跳，失联 ≥30 分钟且 60 分钟内没拉起过 → `orca terminal create` 在主 checkout 开新的维护会话，并推送。这是 Mac agent 对 Orca 唯一的写操作。
- 授权状态：`gmail-read`（每小时）、`claude-mac`（认证失败/恢复时）。
- hub 重启时（502/503/504、连接失败）退避重试约 30 秒。

口味档案主要依据口味笔记和"问问"过的卡片（带 card_id 的对话消息），另有：`MOJITO_ZOTERO_DB`（作者、最近加入；只读 immutable 打开；`none` 时不用）、收藏/不感兴趣的卡片、口味笔记、active 项目 summary。

chat_reply 的回复还可以：
- `new_items`（直接进行中）、`goal_updates`、`project_updates`、`plan_updates`、`settings_update`、`card_actions`、`note_links`、`taste_notes`：用户在对话里要求的都直接执行，"从 X 改成 Y"记录和撤销由 hub 写。
- `run_jobs`：用户说"现在跑 / 刷新一下 / 同步项目 / 现在复盘"时立刻 `POST /worker/jobs`（`refresh`、`sync_projects`、`draft_review`、`feed_brief`、`feed_watch`、`feed_mail`，`runner=mac`，hub 同 kind 去重），在其他改动之后入队。
- 对话原则（design 8.7）：app 能点的都能做；只有对外发送、操作 Orca 终端、改 mojito 代码（说成建议，引导到"反馈与建议"）不做。回复可用 Markdown 粗体/列表/链接，推送标题去掉 Markdown 标记。
- `subscription_updates`：改订阅时间（`PUT /subscriptions/{id}`，以当前 `at`/`config` 为底）、开关（`POST /subscriptions/{id}/enabled`）、watch 的实验室名单（`config.labs`，全量写回、其余 config 保留）。
- `item_updates`：直接 `PUT /items`（以当前事项为底全量写回，`done_definition` 不动）；"从 X 改成 Y"记录和撤销由 hub 写。"删掉/不要了"= `closed`，"做完了"= `done`。
- `plan_changes`：只在 Claude 自己建议时用，`POST /plans` 起草修订版（`revises` = 当前计划，id `<原 id>-r<本地 YYYYMMDDHHMMSS>`），进"等你拍板"。
- 带 `card_id` 的消息（"问问这个"）把卡片放进上下文；带图片的消息把图作为 image block 交给 Claude。

界面语言（api.md 界面语言）：每个任务先 `GET /settings` 读 `language`（`zh`/`en`，缺了报错），Claude 写的文字按 `prompting.user_text_rules(lang)` 出该语言；脚本自己拼的文字用 `i18n.say(lang, "<中文模板>")` 查英文表（缺翻译报 KeyError）。

多行文字（对话回复、草稿正文、本周总结）让 Claude 按行给字符串数组（`prompting.LINES_SCHEMA`），脚本用换行拼接，避免模型把换行多转义成字面 `\n`。

写给用户看的标题/正文：时间用本地时区的短格式（9/28 00:50），不写内部 id（只放 evidence），不写英文枚举值（`prompting.USER_TEXT_RULES`）。

chat_reply 能查的本地数据（全部只读，Claude 不拿工具，由脚本执行）：

| 动作 | 来源 | 限制 |
|---|---|---|
| `find_files` / `read_file` / `git_log` | `MOJITO_PROJECTS_ROOT` 下的 git 仓库 | 只读已跟踪文件（`.env` 等被拒），单文件 20KB |
| `gmail_search` / `gmail_read` | Gmail API（`gmail.readonly`），凭据只在本机：`MOJITO_GMAIL_OAUTH_FILE`（google-auth authorized-user JSON，桌面 OAuth 客户端，只有 `gmail.readonly`，refresh 后不写回；启动时和每小时换一次 token，结果报 auth-status `gmail-read`） | 缺凭据时回复"还没接上" |
| `orca_overview` / `orca_terminal_read` | `orca worktree ps`、`orca terminal list/read` | 只读，从不向终端发送输入 |

终端输出、终端预览、邮件正文在交给 Claude 前会隐去看起来像密钥的字符串（`redact.py`）。

## launchd

标签 `com.example.mojito.worker`，`KeepAlive`，日志 `~/Library/Logs/mojito-worker.log`。PATH 里的 `~/.local/bin` 由 install.sh 按 `$HOME` 渲染（`__HOME__`）。

```
worker/launchd/install.sh      # 检查 .env、uv sync、渲染 plist 到 ~/Library/LaunchAgents 并 bootstrap
launchctl bootout gui/$(id -u)/com.example.mojito.worker   # 卸载
tail -f ~/Library/Logs/mojito-worker.log
```
