// 运行期间每 30 秒调 hub 的 GET /pulse（docs/api.md "Mac app 取新事件"）：
// 更新菜单栏和 Dock 角标；interrupt 弹 macOS 通知；通知所有窗口刷新。游标存在 app 数据目录。
use serde::Deserialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Manager};

const INTERVAL: Duration = Duration::from_secs(30);
const LIMIT: u32 = 50;
// 一轮要弹的通知超过这个数，合并成一条"有 N 条新消息"
const MERGE_OVER: usize = 3;
// 菜单栏里事项标题最多显示的字数
const TITLE_MAX: usize = 14;

#[derive(Deserialize)]
struct Pulse {
    cursor: String,
    records: Vec<Record>,
    more: bool,
    counts: Counts,
}

#[derive(Deserialize)]
struct Counts {
    due_today: u64,
    needs_you: u64,
}

#[derive(Deserialize)]
struct Today {
    focus: Vec<FocusItem>,
}

// focus 里的事项都有 next_at（hub 按 next_at 选出），days_until 只在 /today 里有
#[derive(Deserialize)]
struct FocusItem {
    title: String,
    next_at: String,
    days_until: i64,
}

#[derive(Deserialize)]
struct Record {
    tier: String,
    kind: String,
    // 会推送的 tier（interrupt / digest / quiet）hub 都给了 category
    category: String,
    item_id: Option<String>,
    title: String,
    body: String,
}

// GET /settings 里的通知开关（design 8.6：手机推送和 Mac 通知都按它过滤）
#[derive(Deserialize)]
struct Settings {
    notify: std::collections::HashMap<String, bool>,
}

#[derive(Clone, serde::Serialize)]
struct PulseEvent {
    due_today: u64,
    needs_you: u64,
    new_records: usize,
}

enum Failure {
    // hub 地址或令牌还没在系统页填
    NotConfigured,
    // 401 / 403：令牌不对，要用户重新输入
    Auth(u16),
    // 网络错误或 5xx：下次照常重试，游标不丢
    Transient(String),
}

pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 每 30 秒一轮，空闲连接多半已被 Funnel 或睡眠、换网弄断，复用它只会等到超时：不留空闲连接，每轮重新连。
        // 连不上 8 秒就算失败（被丢的 SYN 重传 1–3 秒内一般就通了），下一轮照常重试
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(0)
            .build()
            .unwrap();
        loop {
            match tick(&app, &client).await {
                Ok(()) => {}
                Err(Failure::NotConfigured) => crate::tray::show_problem(&app, "还没设置 hub").unwrap(),
                Err(Failure::Auth(status)) => {
                    crate::tray::show_problem(&app, "令牌无效").unwrap();
                    app.emit("auth-failed", status).unwrap();
                }
                Err(Failure::Transient(e)) => crate::weblog::write(&app, &format!("pulse：{e}")).unwrap(),
            }
            // 查新版出错只记日志，不能让轮询停掉
            if let Err(e) = crate::update::check(&app) {
                crate::weblog::write(&app, &format!("查新版：{e}")).unwrap();
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

async fn tick(app: &tauri::AppHandle, client: &reqwest::Client) -> Result<(), Failure> {
    let (hub_url, token) = match (secret(crate::secrets::KEY_HUB_URL)?, secret(crate::secrets::KEY_TOKEN)?) {
        (Some(u), Some(t)) => (u, t),
        _ => return Err(Failure::NotConfigured),
    };
    let base = hub_url.trim_end_matches('/').to_string();
    let cursor_path = cursor_file(app);
    let mut cursor = read_cursor(&cursor_path)?;
    let mut fresh: Vec<Record> = Vec::new();
    let mut new_records = 0;
    let counts = loop {
        let mut query = vec![("limit", LIMIT.to_string())];
        if let Some(c) = &cursor {
            query.push(("after", c.clone()));
        }
        let page: Pulse = get_json(client, &base, &token, "/pulse", &query).await?;
        new_records += page.records.len();
        fresh.extend(page.records);
        // 每页取完就存游标：中途断了下次从这里接着补
        std::fs::write(&cursor_path, &page.cursor).map_err(|e| Failure::Transient(format!("写游标 {}：{e}", cursor_path.display())))?;
        cursor = Some(page.cursor);
        if !page.more {
            break page.counts;
        }
    };

    // 菜单栏写今日重点的第一件（/today.focus 已按 next_at 升序）
    let today: Today = get_json(client, &base, &token, "/today", &[]).await?;
    crate::tray::show_next(app, today.focus.first().map(focus_label)).unwrap();
    crate::tray::show_badge(app, counts.needs_you).unwrap();
    notify_records(app, client, &base, &token, fresh).await?;
    app.emit("pulse", PulseEvent { due_today: counts.due_today, needs_you: counts.needs_you, new_records }).unwrap();
    Ok(())
}

// 和手机推送同一范围（/pulse 只回 interrupt / digest / quiet），按用户的通知开关过滤；
// 主窗口在前台时不弹（用户正看着 app）。一轮超过 MERGE_OVER 条合并成一条。
async fn notify_records(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    base: &str,
    token: &str,
    records: Vec<Record>,
) -> Result<(), Failure> {
    if records.is_empty() || app.get_webview_window(crate::MAIN).unwrap().is_focused().unwrap() {
        return Ok(());
    }
    let settings: Settings = get_json(client, base, token, "/settings", &[]).await?;
    let wanted: Vec<Record> = records
        .into_iter()
        .filter(|r| settings.notify[&r.category])
        .collect();
    if wanted.len() > MERGE_OVER {
        let sound = wanted.iter().any(|r| r.tier != "quiet");
        crate::notify::show(app, "Mojito".into(), format!("有 {} 条新消息", wanted.len()), "/".into(), sound);
        return Ok(());
    }
    for r in wanted {
        let path = if r.kind == "chat" {
            "/chat".to_string()
        } else {
            match &r.item_id {
                Some(id) => format!("/items/{id}"),
                None => "/".to_string(),
            }
        };
        let sound = r.tier != "quiet";
        crate::notify::show(app, r.title, r.body, path, sound);
    }
    Ok(())
}

async fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<T, Failure> {
    let res = client
        .get(format!("{base}{path}"))
        .bearer_auth(token)
        .query(query)
        .send()
        .await
        // {:?} 带上底层原因（DNS / TLS / 连接被关），{} 只有"error sending request"
        .map_err(|e| Failure::Transient(format!("连不上 hub：{e:?}")))?;
    let status = res.status().as_u16();
    if status == 401 || status == 403 {
        return Err(Failure::Auth(status));
    }
    let text = res.text().await.map_err(|e| Failure::Transient(format!("读 {path} 响应：{e}")))?;
    if status != 200 {
        return Err(Failure::Transient(format!("{path} {status}：{text}")));
    }
    serde_json::from_str(&text).map_err(|e| Failure::Transient(format!("解析 {path}：{e}：{text}")))
}

// "修注册页 bug · 22:00"（今天，用户时区的时间）/ "把 beta 发给朋友… · 还有 1 天"；标题超过 TITLE_MAX 字截断
fn focus_label(item: &FocusItem) -> String {
    let title: String = if item.title.chars().count() > TITLE_MAX {
        item.title.chars().take(TITLE_MAX).collect::<String>() + "…"
    } else {
        item.title.clone()
    };
    let when = if item.days_until == 0 {
        let at = chrono::DateTime::parse_from_rfc3339(&item.next_at).expect("next_at 不是 ISO-8601");
        at.with_timezone(&local_zone()).format("%H:%M").to_string()
    } else {
        format!("还有 {} 天", item.days_until)
    };
    format!("{title} · {when}")
}

// 用户时区：编译时从 MOJITO_TIMEZONE 读（desktop/.env，和 hub 的 MOJITO_TIMEZONE 相同），没设就编译失败
fn local_zone() -> chrono_tz::Tz {
    env!("MOJITO_TIMEZONE").parse().expect("MOJITO_TIMEZONE 不是 IANA 时区名")
}

fn secret(key: &str) -> Result<Option<String>, Failure> {
    crate::secrets::get(key).map_err(Failure::Transient)
}

fn cursor_file(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("pulse-cursor")
}

// 没有游标（首次启动）→ None：hub 只回当前游标和计数，不把历史当新事件
fn read_cursor(path: &PathBuf) -> Result<Option<String>, Failure> {
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| Failure::Transient(format!("读游标 {}：{e}", path.display())))
}
