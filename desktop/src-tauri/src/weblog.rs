// ~/Library/Logs/com.example.mojito/webview.log：网页报错和网页进程被回收的记录
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub fn write(app: &tauri::AppHandle, msg: &str) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| format!("日志目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建日志目录 {}：{e}", dir.display()))?;
    let path = dir.join("webview.log");
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开 {}：{e}", path.display()))?;
    writeln!(file, "{secs} {msg}").map_err(|e| format!("写 {}：{e}", path.display()))
}
