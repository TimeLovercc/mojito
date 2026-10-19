mod fetch;
mod notify;
mod pulse;
mod secrets;
mod theme;
mod tray;
mod update;
mod webcache;
mod weblog;

use tauri_plugin_autostart::ManagerExt;
use tauri::utils::TitleBarStyle;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

// 没有这一项返回 null（同 expo-secure-store 的 getItemAsync）
#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    secrets::get(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

// 删除不存在的项不算错（同 expo-secure-store 的 deleteItemAsync）
#[tauri::command]
fn secret_remove(key: String) -> Result<(), String> {
    secrets::remove(&key)
}

// shell.js 转来的网页报错
#[tauri::command]
fn log_web(app: tauri::AppHandle, msg: String) -> Result<(), String> {
    weblog::write(&app, &msg)
}

// 菜单栏面板高度随内容（docs/desktop-v2.md §8），shell.js 在面板里量 #menubar-content 后调
#[tauri::command]
fn set_size(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    tray::set_height(&app.get_webview_window(tray::PANEL).unwrap(), height).map_err(|e| format!("设面板高度：{e}"))
}

// 外部链接（shell.js 接管 window.open 和外链 <a> 后调）：交给 macOS 的 open，用系统默认浏览器或对应 app 打开。
// WKWebView 自己会把 window.open 直接丢掉。只放行 app 用到的协议：http / https（简报、卡片原文、页面里的外链），
// orca（系统页"去 Orca"，Orca.app 注册的 orca://），claude（研究卡片的 Claude 按钮，Claude.app 注册的
// claude://claude.ai/<路径>，design.md 8.13）；其他拒绝并记日志
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_url(&app, &url)
}

fn open_url(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let scheme = reqwest::Url::parse(url).map_err(|e| format!("链接 {url}：{e}"))?.scheme().to_string();
    if !matches!(scheme.as_str(), "http" | "https" | "orca" | "claude") {
        weblog::write(app, &format!("open_external refused {url}"))?;
        return Err(format!("不打开 {scheme}: 链接（只放行 http、https、orca、claude）"));
    }
    let status = std::process::Command::new("/usr/bin/open").arg(url).status().map_err(|e| format!("open {url}：{e}"))?;
    if !status.success() {
        return Err(format!("open {url} 失败：{status}"));
    }
    Ok(())
}

// 研究卡片的 ChatGPT 按钮（design.md 8.13）：ChatGPT 对话只能开网页。默认浏览器是 Chrome，先用 AppleScript 在 Chrome 各窗口里
// 找网址以这个链接开头的标签页，找到就切过去（窗口提到最前），找不到再在最前面的窗口新开一个，不重复开标签。
// 第一次会弹 macOS 的"Mojito 想控制 Google Chrome"，用户不允许时报错并说明去哪里打开（Info.plist 有用途说明）
const CHROME_TAB_SCRIPT: &[&str] = &[
    "on run argv",
    "set target to item 1 of argv",
    "tell application \"Google Chrome\"",
    "repeat with w in windows",
    "set n to count of tabs of w",
    "repeat with i from 1 to n",
    "if (URL of tab i of w) starts with target then",
    "set active tab index of w to i",
    "set index of w to 1",
    "activate",
    "return \"reused\"",
    "end if",
    "end repeat",
    "end repeat",
    "if (count of windows) = 0 then make new window",
    "tell window 1 to make new tab with properties {URL:target}",
    "activate",
    "return \"opened\"",
    "end tell",
    "end run",
];

#[tauri::command]
fn open_chat_tab(app: tauri::AppHandle, url: String) -> Result<String, String> {
    if reqwest::Url::parse(&url).map_err(|e| format!("链接 {url}：{e}"))?.scheme() != "https" {
        weblog::write(&app, &format!("open_chat_tab refused {url}"))?;
        return Err(format!("不打开 {url}（只接受 https 链接）"));
    }
    let mut cmd = std::process::Command::new("/usr/bin/osascript");
    for line in CHROME_TAB_SCRIPT {
        cmd.arg("-e").arg(line);
    }
    // 链接作为参数传进脚本（argv），不拼进脚本文本
    let out = cmd.arg(&url).output().map_err(|e| format!("osascript：{e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        weblog::write(&app, &format!("open_chat_tab failed {url}: {err}"))?;
        if err.contains("-1743") {
            return Err("Mojito 没有控制 Google Chrome 的权限：在 系统设置 › 隐私与安全性 › 自动化 里打开 Mojito 下的 Google Chrome".to_string());
        }
        return Err(format!("在 Chrome 里打开 {url} 失败：{err}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// 本地文件（项目页论文块的 PDF / 评审 / 文件夹，docs/api.md「项目概况」）：交给 macOS 的 open，
// 用系统默认程序打开（PDF 用预览、文件夹用 Finder）。只接受存在的绝对路径；不接受的记日志
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !path.starts_with('/') || !std::path::Path::new(&path).exists() {
        weblog::write(&app, &format!("open_path refused {path}"))?;
        return Err(format!("不打开 {path}（要存在的绝对路径）"));
    }
    let status = std::process::Command::new("/usr/bin/open").arg(&path).status().map_err(|e| format!("open {path}：{e}"))?;
    if !status.success() {
        weblog::write(&app, &format!("open_path failed {path}: {status}"))?;
        return Err(format!("open {path} 失败：{status}"));
    }
    Ok(())
}

#[tauri::command]
fn set_theme(app: tauri::AppHandle, scheme: String) -> Result<(), String> {
    theme::set(&app, &scheme)
}

#[tauri::command]
fn relaunch(app: tauri::AppHandle) {
    update::relaunch(&app);
}

// 菜单栏面板里"打开 Mojito"/"打开"：收起面板，主窗口到前台并跳到 path（如 "/"、"/items/<id>"）
#[tauri::command]
fn open_main(app: tauri::AppHandle, path: String) -> Result<(), String> {
    show_main(&app, &path).map_err(|e| format!("打开主窗口：{e}"))
}

pub(crate) fn show_main(app: &tauri::AppHandle, path: &str) -> tauri::Result<()> {
    app.get_webview_window(tray::PANEL).unwrap().hide()?;
    let main = app.get_webview_window(MAIN).unwrap();
    main.show()?;
    main.unminimize()?;
    main.set_focus()?;
    main.emit_to(MAIN, "navigate", path)
}

pub(crate) const MAIN: &str = "main";

// WKWebView 的默认 UA 不带 "Safari"，expo-font 因此走 fontfaceobserver，
// 在 WKWebView 里 12 秒超时、整页白屏。报成 Safari 后 expo-font 跳过它（同真 Safari）。
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15 mojito-desktop";

// 主窗口和菜单栏面板都加载 mobile 的网页构建，只是路由不同。
// 新窗口请求：顶层页面的 window.open 和外链 <a> 已由 shell.js 接走；剩下的来自页面 iframe（docs/api.md「页面」，
// 签名链接的 HTML 页，sandbox 允许弹窗）里的 target=_blank 和 window.open。shell.js 进不了跨源 iframe，
// WKWebView 把这些交给 on_new_window：一律不开新窗口，链接交给系统浏览器（同 open_external 的协议白名单），打不开记日志
pub(crate) fn web_window<'a>(
    app: &'a tauri::App,
    label: &'a str,
    route: &str,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::App> {
    let handle = app.handle().clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
        .theme(theme::saved(app.handle()).expect("读配色设置失败"))
        .user_agent(USER_AGENT)
        .initialization_script(include_str!("shell.js"))
        .on_new_window(move |url, _features| {
            if let Err(err) = open_url(&handle, url.as_str()) {
                weblog::write(&handle, &format!("new window {url}: {err}")).unwrap();
            }
            tauri::webview::NewWindowResponse::Deny
        })
}

fn build_main(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let main = web_window(app, MAIN, "index.html")
        .title("Mojito")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1000.0, 680.0)
        // 标题栏透明、不显示标题；红黄绿和页面 52 高的顶栏同一行、垂直居中
        // （实测 y=27 时圆心在 24.5pt，28 对准 26pt；docs/desktop-v2.md 第 0 步验证）
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 28.0))
        // 浅色时窗口背后是 macOS 侧边栏毛玻璃，页面里透明的部分（侧边栏）透出它；深色时关掉（theme::apply_sidebar）
        .transparent(true)
        .build()?;
    theme::apply_sidebar(&main, main.theme()?)?;
    // 关主窗口只是隐藏：app 留在菜单栏继续取新事件；点 Dock 图标再打开
    let handle = main.clone();
    main.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            handle.hide().unwrap();
        }
        // 实际深浅变了（跟随系统时系统切换，或 set_theme 改了）：跟着开关毛玻璃
        WindowEvent::ThemeChanged(theme) => theme::apply_sidebar(&handle, *theme).unwrap(),
        _ => {}
    });
    Ok(main)
}

// 开机自启默认打开，只在第一次启动时开一次；之后以系统页开关为准。
// 只对装进 ~/Applications 的包做：登录项记的是当前可执行文件路径，
// 从 debug 构建或 target/ 里的包启动时注册，会指向以后不存在的路径。
fn enable_autostart_once(app: &tauri::AppHandle) -> tauri::Result<()> {
    if !app.state::<update::State>().from_installed {
        return Ok(());
    }
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let marker = dir.join("autostart-initialized");
    if marker.exists() {
        return Ok(());
    }
    app.autolaunch().enable().expect("打开开机自启失败");
    std::fs::write(marker, "")?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(update::state().expect("取启动路径失败"))
        .manage(fetch::state())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // 网页内容进程被系统回收（长时间空闲、内存紧张）后窗口会整页白：记一笔并重载
        .on_web_content_process_terminate(|webview| {
            weblog::write(webview.app_handle(), &format!("{} web content process terminated, reloading", webview.label())).unwrap();
            webview.reload().unwrap();
        })
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_remove, open_main, log_web, relaunch, set_theme, set_size, open_external, open_chat_tab, open_path, fetch::hub_fetch])
        .setup(|app| {
            build_main(app)?;
            tray::build(app)?;
            webcache::clear_if_hub_changed(app.handle())?;
            notify::init();
            enable_autostart_once(app.handle())?;
            pulse::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("mojito desktop 启动失败")
        .run(|app, event| {
            // 主窗口隐藏时点 Dock 图标：重新显示
            if let RunEvent::Reopen { .. } = event {
                let main = app.get_webview_window(MAIN).unwrap();
                main.show().unwrap();
                main.set_focus().unwrap();
            }
        });
}
