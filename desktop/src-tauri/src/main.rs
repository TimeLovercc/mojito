// release 下不弹终端窗口（只影响 Windows，Mac 无效果，照 Tauri 模板保留）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mojito_desktop_lib::run()
}
