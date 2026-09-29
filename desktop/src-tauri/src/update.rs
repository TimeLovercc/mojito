// 自动更新（design 8.4 第 4 步）：发布脚本（scripts/release.mjs）把新版装进 ~/Applications/Mojito.app。
// 正在运行的旧版每轮检查磁盘上的版本号，变了就弹一次通知"新版已装好，点这里重启"，并通知页面（事件 update-ready）。
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// 装好的位置：~/Applications/Mojito.app
pub fn installed_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").expect("HOME 未设置");
    std::path::PathBuf::from(home).join("Applications/Mojito.app")
}

pub struct State {
    // 启动时记下：运行中包会被发布脚本整个换掉，那时再问"当前可执行文件在哪"会因旧文件已删而出错
    pub from_installed: bool,
    // 已经提示过的新版本，避免每 30 秒重复弹
    pub prompted: Mutex<Option<String>>,
}

pub fn state() -> Result<State, String> {
    let exe = std::env::current_exe().map_err(|e| format!("取可执行文件路径：{e}"))?;
    Ok(State { from_installed: exe.starts_with(installed_path()), prompted: Mutex::new(None) })
}

pub fn check(app: &tauri::AppHandle) -> Result<(), String> {
    // 只有装在 ~/Applications 里的才自动更新；debug 构建、target/ 里的包不管
    let state = app.state::<State>();
    if !state.from_installed {
        return Ok(());
    }
    let installed = installed_version()?;
    let running = app.package_info().version.to_string();
    if installed == running {
        return Ok(());
    }
    let mut last = state.prompted.lock().unwrap();
    if last.as_deref() == Some(installed.as_str()) {
        return Ok(());
    }
    *last = Some(installed.clone());
    crate::weblog::write(app, &format!("新版已装好 {running} → {installed}，已提示重启"))?;
    app.emit("update-ready", &installed).map_err(|e| format!("发 update-ready：{e}"))?;
    crate::notify::show_then(
        app,
        "Mojito 新版已装好".into(),
        format!("{running} → {installed}，点这里重启生效"),
        true,
        relaunch,
    );
    Ok(())
}

// 页面上"重启"按钮也可以调它（invoke('relaunch')）
pub fn relaunch(app: &tauri::AppHandle) {
    std::process::Command::new("open")
        .arg("-n")
        .arg(installed_path())
        .spawn()
        .expect("启动新版 mojito 失败");
    app.exit(0);
}

// Info.plist 里的 CFBundleShortVersionString（tauri 打包时写入 version）
fn installed_version() -> Result<String, String> {
    let path = installed_path().join("Contents/Info.plist");
    let path = path.display();
    let plist = std::fs::read_to_string(path.to_string()).map_err(|e| format!("读 {path}：{e}"))?;
    let key = "<key>CFBundleShortVersionString</key>";
    let after = &plist[plist.find(key).ok_or(format!("{path} 里没有 {key}"))? + key.len()..];
    let start = after.find("<string>").ok_or(format!("{path} 版本号格式不对"))? + "<string>".len();
    let end = after.find("</string>").ok_or(format!("{path} 版本号格式不对"))?;
    Ok(after[start..end].trim().to_string())
}
