# pages

Claude / Codex 会话读写 mojito "页面"：固定路径、反复修改的自包含 HTML（`docs/api.md`"页面"）。一次性的报告仍发信息流卡片；要反复回来看、会持续更新的内容（一件在办的事、一个项目的总览、一台机器的配置）放页面。

## 安装

```bash
sources/pages/install.sh      # 软链到 ~/.local/bin/pages，不改任何其它配置
```

在每台要读写页面的机器上装一次（软链指向仓库里的脚本，`git pull` 后即生效）。需要 `uv`（脚本是无依赖的 PEP 723 脚本，Python ≥ 3.11）、shell 环境里的 `MOJITO_SECRETS_DIR`（放秘密文件的目录，在任何仓库之外，同 `sources/cards`）和其中的 `pages.env`（不入库，权限 600，否则报错）。在本机用 `hub/deploy/mac-env.sh source:pages MOJITO_PAGES_TOKEN "$MOJITO_SECRETS_DIR/pages.env"` 生成；别的机器上把这个文件拷过去，`chmod 600`：

```
MOJITO_HUB_URL=https://<你的 hub 地址>
MOJITO_PAGES_TOKEN=<角色 source:pages 的令牌>
```

## 用法

```bash
pages ls [前缀]                                   # path  vN  更新时间（本机时区）  谁改的  标题 / 下一行摘要
pages cat <path> [--text] [--version N]           # html；--text 只给文字
pages pull <path> <文件>                          # 写 html 和 <文件>.version；页面不存在 → 空文件、version 0
pages put <path> <文件> --note "<改了什么>" [--base N] [--by <会话名>]
pages log <path>                                  # 版本列表，新的在前
pages link <path> [--theme dark|light]            # 10 分钟浏览器链接；不给 --theme 时读 macOS 深浅色，其它系统必须给
pages rm <path> --base N --note "<为什么删>" [--by <会话名>]   # 软删除，成功打印"已删除 <path>（vN）"
```

- `put` 的 base：`--base`，否则读 `<文件>.version`，都没有就报错；成功后更新 `.version`。409（hub 回 `{"detail": {"message", "version", "updated_by"}}`）→ 打印"<谁> 在你之后改过（当前 vN），先 pull 合并再 put"；页面还不存在而 base 不是 0 时 `updated_by` 为 null，打印"还不存在（当前 v0）"；path 已删除时 `message` 里有"已删除"，原样打印。都以非 0 退出。
- 删除（`docs/api.md`"删除页面"）：`rm` 的 `--base` 必填，是当前版本（`pages ls` / `pages log` 里看）。409 → 打印"<谁> 在你之后改过（当前 vN）"；404（从没写过：`page <path> not found`；已删除：`page <path> was deleted at <时间> by <谁>`）和 422（`--base 0`、空 note）打印 hub 的 `detail`；都以非 0 退出。删掉的 path 不能复用：`pull` 遇到"was deleted"直接报错（不写空文件），`put` 得 409。
- 写入者 `by`：不给 `--by` 时取当前会话名：
  - Claude Code：`CLAUDE_CODE_SESSION_ID` 对应的会话记录 `~/.claude/projects/*/<id>.jsonl` 里最后一条 `custom-title`（`claude -n <名字>` 和 `/rename` 都会写）。
  - Codex：`CODEX_THREAD_ID` 在 `~/.codex/session_index.jsonl` 里最后一条 `thread_name`（Codex 的 `/rename` 写）。
  - 两个变量都没有、都有（一个 agent 跑在另一个里面）、会话没名字、名字不是 `小写-短横` 形式（如 Codex 自动起的 "Check build status"）→ 报错，要求 `--by`。
- path：本地按 hub 的规则先查一遍（`page_store.PATH_PATTERN`）：1–4 段小写字母、数字、`-`，用 `/` 分隔；`_smoke/` 后面再跟 1–3 段（测试专用，`ls` 不列）；任何一段都不能叫 `versions` 或 `link`。html 的规则（title、description、大小等）由 hub 返回 422，命令打印 hub 的 `detail`。
- `pages.env` 缺失、缺变量、权限不是 600、hub 返回其它错误 → 非 0 退出。

## 让会话用起来

在你给 Claude Code / Codex 的全局说明（`CLAUDE.md` / `AGENTS.md`）里写一条：做某个主题的事之前先 `pages ls`、`pages cat <path> --text`；事实变了就 pull → 改 → put 那一页（带一句 note），不要另开一页；409 就重新 pull 合并再 put。页面只引用 hub 的 `/pages-assets/base.css` 配色，时间写你的时区，最上面放一块"现在的状态"。
