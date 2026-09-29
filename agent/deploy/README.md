# agent 部署（服务器）

布局按 `docs/api.md` v2a 运行约定：代码 `/opt/mojito/agent`，env `/var/lib/mojito/agent.env`，服务 `mojito-agent`，用户 `mojito`。

## 一次性准备

1. Claude Code 已为 `mojito` 用户安装：`/var/lib/mojito/.local/bin/claude`（`mojito` 的 HOME 是 `/var/lib/mojito`，claude 写 `~/.claude`，所以 unit 里 `ReadWritePaths=/var/lib/mojito`）。
2. 用户在任意机器上跑 `claude setup-token`，得到 `CLAUDE_CODE_OAUTH_TOKEN`。
3. 在 hub 令牌文件里加一个角色为 `agent` 的令牌（hub 需已支持 v2a）。
4. 写 `/var/lib/mojito/agent.env`（`root:mojito`、`0640`，永不入库），六项全部必填，缺一个服务启动即退出：
   ```
   MOJITO_HUB_URL=http://127.0.0.1:8787
   MOJITO_AGENT_TOKEN=<agent 令牌>
   CLAUDE_CODE_OAUTH_TOKEN=<setup-token 输出>
   MOJITO_CLAUDE_BIN=/var/lib/mojito/.local/bin/claude
   MOJITO_GOOGLE_OAUTH=/var/lib/mojito/google-oauth.json
   MOJITO_TIMEZONE=<IANA 时区，和 hub 的 MOJITO_TIMEZONE 相同，如 Europe/Berlin>
   ```
   `google-oauth.json` 是用户授权后 google-auth 的 authorized-user JSON（`creds.to_json()`：`client_id`、`client_secret`、`refresh_token`、`token_uri`、`scopes`，由 `hub/deploy/google-auth.py --scope calendar` 生成；agent 只请求 `calendar.events`、不写回），`mojito:mojito`、`0600`，永不入库。
   uv 相关变量（`UV_PROJECT_ENVIRONMENT=/var/lib/mojito/agent-venv` 等）也放进 `agent.env`：`uv sync` 和服务里的 `uv run --no-sync` 必须用同一个 venv。

## 每次部署（在 /opt/mojito 已更新到目标提交之后）

```
sudo -u mojito env $(sudo grep '^UV_' /var/lib/mojito/agent.env) \
  /usr/local/bin/uv sync --frozen --no-dev --project /opt/mojito/agent
sudo install -m 644 /opt/mojito/agent/deploy/mojito-agent.service /etc/systemd/system/mojito-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now mojito-agent
sudo systemctl restart mojito-agent
```

## 检查

- `journalctl -u mojito-agent -f`：应看到 `agent started`，之后每个任务一行 `job ... done/failed`。
- `GET /sources`（app 令牌）里 `server-agent` 为 `alive`（心跳 `expected_interval_s=300`，空闲时每 10 秒一次）。
- 冒烟：app 里发一条对话，几秒内应收到回复推送。
- 内存：`systemctl show mojito-agent -p MemoryCurrent`；空闲时只有 Python 进程，`claude -p` 只在任务期间存在。
