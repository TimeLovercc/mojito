// 窗口深浅色跟随 app 的配色设置（docs/desktop-v2.md #14）：毛玻璃、红黄绿、滚动条跟着变。
// 页面调 invoke('set_theme', { scheme })，scheme 同 mobile/src/theme.ts 的 COLOR_SCHEMES：'system' | 'dark' | 'light'。
// 主窗口和菜单栏面板一起改；选择记在 app 数据目录，下次启动建窗口时就带上，首屏之前生效。
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{Manager, Theme, WebviewWindow};

fn file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建目录 {}：{e}", dir.display()))?;
    Ok(dir.join("color-scheme"))
}

fn parse(scheme: &str) -> Result<Option<Theme>, String> {
    match scheme {
        "system" => Ok(None),
        "dark" => Ok(Some(Theme::Dark)),
        "light" => Ok(Some(Theme::Light)),
        other => Err(format!("配色只能是 system / dark / light，收到 {other}")),
    }
}

// 用户还没在 app 里选过配色 = 跟随系统（同 mobile 的 colorSchemeSetting）
pub fn saved(app: &tauri::AppHandle) -> Result<Option<Theme>, String> {
    let path = file(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let scheme = std::fs::read_to_string(&path).map_err(|e| format!("读 {}：{e}", path.display()))?;
    parse(scheme.trim())
}

// 主窗口侧栏：浅色用 macOS 侧栏毛玻璃，深色关掉（侧栏由页面画不透明 #0c0c0c，保证层次；
// docs/desktop-v2.md 用户拍板）。毛玻璃的饱和度是系统材质固定的，没有参数可调。
pub fn apply_sidebar(main: &WebviewWindow, theme: Theme) -> tauri::Result<()> {
    match theme {
        Theme::Dark => main.set_effects(None),
        _ => main.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::FollowsWindowActiveState)
                .build(),
        ),
    }
}

pub fn set(app: &tauri::AppHandle, scheme: &str) -> Result<(), String> {
    let theme = parse(scheme)?;
    app.set_theme(theme);
    // ThemeChanged 也会跟着来；这里按设完后的实际深浅再设一次，不依赖事件先后
    let main = app.get_webview_window(crate::MAIN).unwrap();
    let actual = main.theme().map_err(|e| format!("取窗口深浅：{e}"))?;
    apply_sidebar(&main, actual).map_err(|e| format!("设侧栏毛玻璃：{e}"))?;
    let path = file(app)?;
    std::fs::write(&path, scheme).map_err(|e| format!("写 {}：{e}", path.display()))
}
