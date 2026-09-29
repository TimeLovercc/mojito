// 页面缓存（WebView 的 localStorage 等）属于某个 hub。hub 地址或令牌在页面之外被改了
// （直接改钥匙串 / dev 存储文件），页面"换 hub 清缓存"的逻辑不会触发，旧 hub 的内容会留着。
// 启动时比对上次记下的 hub 指纹（地址 + 令牌的 sha256，不存令牌本身），变了就清空网页数据并重载。
use sha2::{Digest, Sha256};
use tauri::Manager;

pub fn clear_if_hub_changed(app: &tauri::AppHandle) -> Result<(), String> {
    let url = crate::secrets::get(crate::secrets::KEY_HUB_URL)?;
    let token = crate::secrets::get(crate::secrets::KEY_TOKEN)?;
    let digest = Sha256::digest(format!("{url:?}\n{token:?}"));
    let fingerprint: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    let dir = app.path().app_data_dir().map_err(|e| format!("数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建目录 {}：{e}", dir.display()))?;
    // debug 构建和 release 包的网页数据分开存（WebKit 按可执行文件区分），指纹也分开记
    let path = dir.join(if cfg!(debug_assertions) { "hub-fingerprint-debug" } else { "hub-fingerprint" });
    if path.exists() && std::fs::read_to_string(&path).map_err(|e| format!("读 {}：{e}", path.display()))? == fingerprint {
        return Ok(());
    }
    // 主窗口和面板共用同一份网页数据，清一次、两个都重载
    let main = app.get_webview_window(crate::MAIN).unwrap();
    main.clear_all_browsing_data().map_err(|e| format!("清网页数据：{e}"))?;
    main.reload().map_err(|e| format!("重载主窗口：{e}"))?;
    app.get_webview_window(crate::tray::PANEL).unwrap().reload().map_err(|e| format!("重载面板：{e}"))?;
    std::fs::write(&path, fingerprint).map_err(|e| format!("写 {}：{e}", path.display()))?;
    crate::weblog::write(app, "hub 地址或令牌变了：已清空网页缓存")
}
