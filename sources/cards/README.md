# mojito-card

Orca 里的会话往 mojito "信息流"发一张卡片（`POST /cards`，见 `docs/api.md`"来源 2：会话主动发布"）。

## 安装

```bash
sources/cards/install.sh      # 软链到 ~/.local/bin/mojito-card，不改任何其它配置
```

需要 `uv`（脚本是无依赖的 PEP 723 脚本）、shell 环境里的 `MOJITO_SECRETS_DIR`（放秘密文件的目录，在任何仓库之外），以及其中的 `cards.env`（不入库，由 `hub/deploy/mac-env.sh source:cards MOJITO_CARDS_TOKEN "$MOJITO_SECRETS_DIR/cards.env"` 生成）：

```
MOJITO_HUB_URL=https://<hub-host>.<tailnet>.ts.net
MOJITO_CARDS_TOKEN=<角色 source:cards 的令牌>
```

## 用法

```bash
mojito-card --project <id|none> --kind <paper|idea|report|other> \
  --title "<标题>" --summary "<≤800 字，写清为什么值得看>" \
  [--link <http(s) 链接>] [--key <去重键>] [--origin <来源>]
```

- `--project none` → `project_id=null`。
- `--origin` 不给时取当前 Orca worktree 名（`orca worktree current --json`），记为 `session:<名>`；不在 Orca worktree 里就报错，要求显式给 `--origin`（原样作为 origin 发送）。
- `--key` 不给时用 title 的 sha1 前 16 位；同一来源下 key 重复 → hub 返回 409，命令打印"已经发过"并以 0 退出。
- `--summary` 超过 800 字直接报错，不截断。
- 缺 `MOJITO_SECRETS_DIR`、缺 `cards.env` 或缺变量、缺参数、hub 返回其它错误（打印 hub 的 `detail`）→ 非 0 退出。

## 什么时候该发

- 只在会话**主动判断"有值得看的结果"**时发：某个研究项目找到候选 idea、实验报告写完、读到一篇和项目强相关的论文等。
- **不要**自动抓会话输出、不要每轮都发、不要发进度流水。会话结束之类的事件走 Orca Stop hook 进"动态"，不是卡片。
- summary 是给手机上读的：一两句结论 + 为什么值得看；细节放 `--link`。

## 给会话看的用法说明

（可以加进你的全局指令或各项目的 CLAUDE.md。）

> 当你判断手头有值得用户在手机上读的结果（候选 idea、实验报告完成、强相关论文），用 `mojito-card` 发到 mojito 信息流：
> `mojito-card --project <项目 id 或 none> --kind <paper|idea|report|other> --title "<标题>" --summary "<≤800 字：结论 + 为什么值得看>" [--link <url>]`
> 只在主动判断值得看时发，不要转发普通输出或进度。打印"已经发过"表示同一标题已发布过，无需重试。
