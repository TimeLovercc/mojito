# hub/deploy

在你自己的服务器（Debian/Ubuntu；1GB 内存够 hub + agent）上部署 hub 和 agent。下面的脚本都从你自己的电脑跑：先把 `deploy.env.example` 复制到仓库外（如 `~/.config/mojito/deploy.env`）填好，再 `set -a; . ~/.config/mojito/deploy.env; set +a` 加载；缺哪个变量，脚本就报哪个的名字。

## 日常更新

改代码 → 合并到 `main` → 在仓库任意目录：

```sh
hub/deploy/deploy.sh main "<用户能感知的变化，没有就写：无可见变化>"
```

说明必填，缺了就报错、不部署。部署成功后，它会用 `$MOJITO_SECRETS_DIR/cards.env` 里的令牌往 app 推一条通知：标题是"服务器已更新：<说明第一行>"，正文是其余各行（只有一行时，正文就用这一行）。说明要写给用户看：用中文，不写内部 id。

它会把这个 ref 推到 `<服务器>:/srv/mojito.git`（分支 `deploy`），先把 `hub.db` 在线备份到 `/var/lib/mojito/backups/hub-<时间>-<旧提交>.db`，再把 `/opt/mojito` 重置到该提交，给 hub 和 agent 各做一次 `uv sync --frozen`，安装 `mojito-hub.service` 和 `agent/deploy/mojito-agent.service`，然后重启两个服务。最后确认无令牌访问 `/today` 返回 401，并且 agent 15 秒内没有重启过。可以传任何已提交的 ref 或 SHA。

重启会打断正在跑的任务：被打断的任务停在 `running`，看门狗 30 分钟后才会放回队列，用户的对话就要等这么久。hub 重启的那几秒里，服务器上的 agent 和 Mac worker 调 hub 都会失败，所以 `deploy.sh` 会先等到任何 runner 上都没有 `running` 任务（最多等 2 分钟），然后停掉 agent，重启 hub，再启动 agent。等超时的话照样重启，并在输出里给出 WARNING；这时要去看 `GET /jobs?status=running`。

**重启 Mac worker 也一样**：`launchctl kickstart -k gui/$(id -u)/com.example.mojito.worker` 之前，先确认没有 `runner=mac` 的 `running` 任务：
```sh
curl -s -H "Authorization: Bearer $APP_TOKEN" "$MOJITO_HUB_URL/jobs?status=running&runner=mac"   # 应为 {"jobs": []}
```

## Mac 上的备份与探活（`hub/deploy/mac/`）

安装或更新（先加载 deploy.env）：`hub/deploy/mac/install.sh`。脚本会被复制到 `~/.local/share/mojito/bin/`，然后加载两个 launchd 任务：

| launchd 标签 | 何时 | 做什么 | 日志 |
|---|---|---|---|
| `com.example.mojito.backup` | 每天 03:00（Mac 时区须为 `MOJITO_TIMEZONE`；睡眠错过的话醒来补跑） | 在服务器上用 hub 的 `python -m mojito_hub.snapshot` 生成 `hub.db` 的一致快照 → 拉到 `~/mojito-backup/snapshots/hub-<日期>.db` 并做完整性检查，保留 14 天；附件目录增量同步到 `~/mojito-backup/attachments/`。失败时弹 macOS 通知 | `~/Library/Logs/mojito-backup.log` |
| `com.example.mojito.health` | 每 10 分钟 | 请求公开页 `/`；连续 2 次失败时通知"Mojito hub 连不上"，恢复后再通知一次 | `~/Library/Logs/mojito-health.log` |

立即跑一次备份：`launchctl kickstart gui/$(id -u)/com.example.mojito.backup`。

`deploy.sh` 部署前自己也会在服务器上备份 `hub.db`，放在 `/var/lib/mojito/backups/`。

从备份恢复：`ssh "$MOJITO_SSH_HOST" sudo systemctl stop mojito-agent mojito-hub`，把快照拷成 `/var/lib/mojito/hub.db`（属主 mojito，权限 600），删掉 `hub.db-wal` 和 `hub.db-shm`，然后 `sudo systemctl start mojito-hub mojito-agent`。

回滚：`hub/deploy/deploy.sh <旧 SHA> "<说明>"`；如需回滚数据，停掉服务后用 backups 里的文件覆盖 `hub.db`，同时删掉 `hub.db-wal` 和 `hub.db-shm`。

## 布局

| 路径 | 内容 |
|---|---|
| `/opt/mojito` | 仓库 checkout（属主 `mojito`） |
| `/var/lib/mojito/env` | systemd EnvironmentFile（`MOJITO_*`、`UV_*`），root 600 |
| `/var/lib/mojito/tokens.json` | 令牌，mojito 600 |
| `/var/lib/mojito/agent.env` | mojito-agent 的 EnvironmentFile（hub 地址、agent 令牌、claude 路径、OAuth 令牌、`UV_*`），root 600 |
| `/var/lib/mojito/google-oauth.json` | Google 日历授权（你自己的桌面 OAuth 客户端，只有 calendar.events），agent 用，mojito 600。Gmail 授权永不上服务器 |
| `/var/lib/mojito/fcm.json` | Firebase 服务账号，hub 用，mojito 600 |
| `/var/lib/mojito/.local/bin/claude` | Claude Code（原生安装，mojito 用户） |
| `/var/lib/mojito/hub.db` | SQLite |
| `/var/lib/mojito/attachments/` | 对话图片附件（永久保留），mojito 700 |
| `/var/lib/mojito/venv`、`python`、`uv-cache` | uv 管理的 venv / Python 3.12 / 缓存 |

服务 `mojito-hub` 以 `mojito` 用户运行，监听 `127.0.0.1:8787`；用 `tailscale serve --bg 8787`（只在 tailnet 内）、`tailscale funnel --bg 8787`（公网）、Cloudflare Tunnel 或 Caddy 给它一个 https 地址，这个地址就是 `MOJITO_HUB_URL`。

日志：`ssh "$MOJITO_SSH_HOST" journalctl -u mojito-hub -f`

## 首次搭建

```sh
ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/setup-server.sh                 # 用户、目录、env、bare repo、uv
ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-tokens.sh                  # 补齐 tokens.json，打印新建的 app/worker 令牌，agent 令牌写入 agent.env
uv run hub/deploy/google-auth.py --client "$MOJITO_SECRETS_DIR/google-client.json" --scope calendar --out "$MOJITO_SECRETS_DIR/google-oauth-calendar.json"   # 日历授权（上服务器）
uv run hub/deploy/google-auth.py --client "$MOJITO_SECRETS_DIR/google-client.json" --scope gmail --out "$MOJITO_SECRETS_DIR/google-oauth-gmail.json"      # Gmail 只读授权（只留在本机，永不上服务器）
hub/deploy/install-secrets.sh                                          # $MOJITO_SECRETS_DIR 下的秘密、时区、联系邮箱 → 服务器 env / 文件（不打印）
hub/deploy/deploy.sh main "首次部署"
ssh "$MOJITO_SSH_HOST" 'sudo tailscale serve --bg 8787'                 # 或 funnel / Cloudflare Tunnel / Caddy
```

Google 日历授权失效（半年没用或手动撤销）：重跑 calendar 那条 `google-auth.py` 和 `install-secrets.sh`，再 `ssh "$MOJITO_SSH_HOST" sudo systemctl restart mojito-agent`。

Mac 上需要令牌的工具（信息流卡片、maintainer）：`hub/deploy/mac-env.sh <角色> <变量名> <文件>`，从服务器取出该角色的令牌，连同 `MOJITO_HUB_URL` 写成 600 权限的 env 文件，令牌不会打印出来：
```sh
hub/deploy/mac-env.sh source:cards MOJITO_CARDS_TOKEN "$MOJITO_SECRETS_DIR/cards.env"
```
外部数据源（比如一个往 hub 报心跳的脚本）用 `source:<名字>` 角色：`ssh "$MOJITO_SSH_HOST" 'sudo bash -s source:<名字>' < hub/deploy/gen-tokens.sh`，然后重启 `mojito-hub`，新令牌才会生效。

轮换令牌：`ssh "$MOJITO_SSH_HOST" sudo rm /var/lib/mojito/tokens.json`，重跑 `gen-tokens.sh`，再重启 `mojito-hub`、`mojito-agent`。


## 防火墙

建议：ssh 只在 tailnet（或其他私网）接口上放行，公网入站一律拒绝；hub 只监听 `127.0.0.1`，由 Tailscale serve/funnel 或反向代理对外。云厂商控制台里的安全组 / 防火墙规则也照此收紧。Tailscale serve/funnel 不需要额外的入站端口。

## iPhone 网页版（PWA）

网页版是 mobile 的 `build:pwa` 产物，由 hub 在 `/app/` 下提供（不需要令牌）。每台 iPhone 用自己专用的 app 令牌，推送走 Web Push（VAPID）。约定见 `docs/api.md`「iPhone 网页版（PWA）与 Web Push」。

| 路径 | 内容 |
|---|---|
| `/opt/mojito-web/releases/<sha12>/` | 各版网页构建，root 755/644，hub 只读；保留最近 3 版 |
| `/opt/mojito-web/current` | 指向当前版本的软链接（`MOJITO_WEB_DIR`），切换后立即生效，不用重启 hub |
| `/opt/mojito-web/own/<sha12>.txt` | 该版自己的 `_expo/static` 文件清单，发下一版时只搬运这些 |
| `/var/lib/mojito/vapid.pem` | VAPID 私钥（P-256），mojito 600，只在服务器上，**不进每晚备份**；丢了就重新生成 |

env 里对应的变量：`MOJITO_VAPID_KEY_FILE`、`MOJITO_VAPID_SUBJECT`（`mailto:` + `MOJITO_CONTACT_EMAIL`，即 /privacy 页公开的联系邮箱）、`MOJITO_PUBLIC_URL`（取自 `MOJITO_HUB_URL`）、`MOJITO_WEB_DIR`。

### 首次上线顺序

1. `ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/setup-server.sh`：建 `/opt/mojito-web/releases`，`current` 指向空的 `releases/init`。
2. `ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-vapid.sh`：生成私钥（已有就不动），env 写 `MOJITO_VAPID_KEY_FILE`。
3. `hub/deploy/install-secrets.sh`：env 写联系邮箱、公开地址、时区等其余变量。
4. 确认出站：`ssh "$MOJITO_SSH_HOST" 'curl -sI https://web.push.apple.com; curl -sI https://fcm.googleapis.com'`，两个都要能连上。
5. `hub/deploy/deploy.sh main "<说明>"`：预检会检查新变量；这时 `/app/` 返回 404（目录还是空的）。
6. `hub/deploy/deploy-web.sh main "<说明>"`。

### 发布网页版

```sh
hub/deploy/deploy-web.sh main "<用户能感知的变化>"
```

1. 在 Mac 的临时目录里 `git archive` 出 `mobile/`，然后 `npm ci`，再用 `MOJITO_WEB_BUILD=<sha12>` 执行 `npm run build:pwa`。
2. 检查产物：扩展名在白名单里；没有 `*.map`、`sourceMappingURL`、`EXPO_PUBLIC_`、`u.expo.dev`、`.env*`、密钥文件、apk；`version.json` 的 build 等于 sha12。
3. 上传到 `releases/<sha12>/`，把上一版自己的 `_expo/static` 并入新版（用 `cp -an`，这样还开着旧页面的设备不会 404），然后原子切换 `current`，删到只剩 3 版。
4. 检查 `/app/`、`sw.js`、`pwa-boot.js`、`manifest.webmanifest` 都返回 200，content-type 正确，并带 CSP；`version.json` 的 build 等于 sha12。
5. 推送"网页版已更新：<第一行>"（`category=release`）。
6. 打印网址和二维码（需要 `brew install qrencode`）。

回滚：`ssh "$MOJITO_SSH_HOST" 'cd /opt/mojito-web && sudo ln -sfn releases/<旧 sha12> current.new && sudo mv -T current.new current'`，下次打开 app 时就是旧版。

### iPhone 的令牌

- **给新设备加令牌**：`ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/add-app-token.sh | pbcopy`
  - 令牌直接进剪贴板，终端只显示 `token_ref`；记下"<设备> = <ref>"。
  - 粘贴到 iPhone 后，在 Mac 上执行 `pbcopy </dev/null` 清掉剪贴板。
  - 脚本会重启 hub，重启前最多等 2 分钟，等正在跑的任务结束。
- **吊销**：`ssh "$MOJITO_SSH_HOST" 'sudo bash -s <token_ref>' < hub/deploy/revoke-token.sh`
  - 只删掉恰好一个匹配的令牌，然后重启 hub；hub 启动时会删掉这个令牌的推送订阅。
  - **iPhone 丢了**：立刻用这条命令吊销那台设备的 ref。它马上不能访问 hub，也不再收推送。
  - 删过主屏图标：先加一个新令牌、重新安装，再吊销旧的 ref。
- **轮换全部令牌**：删掉 `tokens.json`，重跑 `gen-tokens.sh`，然后执行 `DELETE FROM devices; DELETE FROM webpush_subscriptions;`（hub 停着时做），再重启 hub 和 agent。之后每台设备重新填令牌，再重新开启推送。

### 轮换 VAPID 密钥

1. `ssh "$MOJITO_SSH_HOST" 'sudo systemctl stop mojito-agent mojito-hub && sudo rm /var/lib/mojito/vapid.pem'`
2. `ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-vapid.sh`
3. `ssh "$MOJITO_SSH_HOST" "sudo -u mojito python3 -c \"import sqlite3; c = sqlite3.connect('/var/lib/mojito/hub.db'); c.execute('DELETE FROM webpush_subscriptions'); c.commit()\""`
4. `ssh "$MOJITO_SSH_HOST" 'sudo systemctl start mojito-hub mojito-agent'`
5. 每台 iPhone 在"系统 → 通知"里重新开启推送。

### 应急（怀疑 `/app/` 被植入恶意 JS）

1. 发一版只含 `index.html` 和一个 `sw.js` 的网页版，`sw.js` 里只调用 `self.registration.unregister()`，用来注销已安装的 Service Worker。放进 `releases/<新目录>/`，然后切换 `current`。
2. 同时轮换全部令牌（见上）。
