// 菜单栏：圆形 logo 图标（icons/tray.png，36px = 18pt@2x）+ 下一件事（如"修注册页 bug · 22:00"），左键点开小面板（mobile 的 /menubar 路由），失焦收起。
// 面板（docs/desktop-v2.md §8）：透明窗口 + macOS Popover 材质、圆角 12、阴影；高度随内容（页面量出来调 set_size），最高 560，超出由页面滚动。
use std::sync::Mutex;

use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewWindow, WindowEvent};

pub(crate) const PANEL: &str = "panel";
const TRAY: &str = "mojito";
const PANEL_W: f64 = 380.0;
const PANEL_MAX_H: f64 = 560.0;

// 最近一次点开时托盘图标的位置：改高度后按它重新定位（macOS 改窗口大小时保持左下角不动，顶边会跑）
pub struct TrayRect(Mutex<Option<Rect>>);

pub fn build(app: &tauri::App) -> tauri::Result<()> {
    let panel = crate::web_window(app, PANEL, "menubar")
        .title("Mojito")
        .inner_size(PANEL_W, PANEL_MAX_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .effects(EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(12.0).build())
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    app.manage(TrayRect(Mutex::new(None)));
    let handle = panel.clone();
    panel.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            handle.hide().unwrap();
        }
    });

    TrayIconBuilder::with_id(TRAY)
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .tooltip("Mojito")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                let panel = tray.app_handle().get_webview_window(PANEL).unwrap();
                toggle(&panel, rect).unwrap();
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle(panel: &WebviewWindow, rect: Rect) -> tauri::Result<()> {
    if panel.is_visible()? {
        return panel.hide();
    }
    *panel.state::<TrayRect>().0.lock().unwrap() = Some(rect);
    place(panel, rect)?;
    panel.emit_to(PANEL, "panel-shown", ())?;
    panel.show()?;
    panel.set_focus()
}

// 面板水平居中在图标下方，顶边在图标下 4pt
fn place(panel: &WebviewWindow, rect: Rect) -> tauri::Result<()> {
    let scale = panel.scale_factor()?;
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let x = pos.x + size.width / 2.0 - PANEL_W * scale / 2.0;
    let y = pos.y + size.height + 4.0 * scale;
    panel.set_position(PhysicalPosition::new(x, y))
}

// 页面量出的内容高度（shell.js 观察 #menubar-content）：面板设成这么高，最高 560；
// 点开过就按托盘图标重新定位，还没点开过等 toggle 时再定位
pub fn set_height(panel: &WebviewWindow, height: f64) -> tauri::Result<()> {
    panel.set_size(LogicalSize::new(PANEL_W, height.min(PANEL_MAX_H)))?;
    let rect = *panel.state::<TrayRect>().0.lock().unwrap();
    match rect {
        Some(rect) => place(panel, rect),
        None => Ok(()),
    }
}

fn tray(app: &tauri::AppHandle) -> TrayIcon {
    app.tray_by_id(TRAY).unwrap()
}

// 菜单栏标题 = 下一件事；没有进行中的事项时只留图标
// 前面加一个细空格（U+2009）：图标和文字之间约 4–5pt
pub fn show_next(app: &tauri::AppHandle, label: Option<String>) -> tauri::Result<()> {
    tray(app).set_title(label.map(|l| format!("\u{2009}{l}")))
}

// Dock 角标 = 等你拍板数，0 时不显示
pub fn show_badge(app: &tauri::AppHandle, needs_you: u64) -> tauri::Result<()> {
    let badge = if needs_you == 0 { None } else { Some(needs_you as i64) };
    app.get_webview_window(crate::MAIN).unwrap().set_badge_count(badge)
}

// 还没设置 hub、令牌无效等：菜单栏直接写出来
pub fn show_problem(app: &tauri::AppHandle, text: &str) -> tauri::Result<()> {
    tray(app).set_title(Some(format!("Mojito · {text}")))
}
