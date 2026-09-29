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

// 主窗口和菜单栏面板都加载 mobile 的网页构建，只是路由不同
pub(crate) fn web_window<'a>(
    app: &'a tauri::App,
    label: &'a str,
    route: &str,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::App> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
        .theme(theme::saved(app.handle()).expect("读配色设置失败"))
        .user_agent(USER_AGENT)
        .initialization_script(include_str!("shell.js"))
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // 网页内容进程被系统回收（长时间空闲、内存紧张）后窗口会整页白：记一笔并重载
        .on_web_content_process_terminate(|webview| {
            weblog::write(webview.app_handle(), &format!("{} web content process terminated, reloading", webview.label())).unwrap();
            webview.reload().unwrap();
        })
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_remove, open_main, log_web, relaunch, set_theme])
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
