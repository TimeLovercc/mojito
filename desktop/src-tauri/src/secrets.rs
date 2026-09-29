// app 令牌和 hub 地址的存放处。
// release 包：macOS 钥匙串（service = app 标识，account = mobile 传来的 key，如 mojito.token）。
// debug 构建：~/Library/Application Support/mojito-dev/secrets.json（权限 600）。
//   未签名的开发二进制每次重编译签名都变，读钥匙串会反复弹授权框，所以开发期不碰钥匙串。

#[cfg(not(debug_assertions))]
mod store {
    use keyring::{Entry, Error as KeyringError};

    const SERVICE: &str = "com.example.mojito";

    fn entry(key: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, key).map_err(|e| format!("钥匙串条目 {key}：{e}"))
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(e) => Err(format!("读钥匙串 {key}：{e}")),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| format!("写钥匙串 {key}：{e}"))
    }

    pub fn remove(key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(format!("删钥匙串 {key}：{e}")),
        }
    }
}

#[cfg(debug_assertions)]
mod store {
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    use std::path::PathBuf;

    fn path() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME 未设置");
        PathBuf::from(home).join("Library/Application Support/mojito-dev/secrets.json")
    }

    fn load() -> Result<BTreeMap<String, String>, String> {
        let p = path();
        if !p.exists() {
            return Ok(BTreeMap::new());
        }
        let text = fs::read_to_string(&p).map_err(|e| format!("读 {}：{e}", p.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("解析 {}：{e}", p.display()))
    }

    fn save(map: &BTreeMap<String, String>) -> Result<(), String> {
        let p = path();
        let dir = p.parent().unwrap();
        fs::create_dir_all(dir).map_err(|e| format!("建目录 {}：{e}", dir.display()))?;
        let text = serde_json::to_string_pretty(map).unwrap();
        // 新建时就是 600；已有文件也改回 600
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&p)
            .map_err(|e| format!("打开 {}：{e}", p.display()))?;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).map_err(|e| format!("改权限 {}：{e}", p.display()))?;
        file.write_all(text.as_bytes()).map_err(|e| format!("写 {}：{e}", p.display()))
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        Ok(load()?.get(key).cloned())
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        let mut map = load()?;
        map.insert(key.to_string(), value.to_string());
        save(&map)
    }

    pub fn remove(key: &str) -> Result<(), String> {
        let mut map = load()?;
        map.remove(key);
        save(&map)
    }
}

pub use store::{get, remove, set};

// mobile 存 hub 地址和令牌用的 key（mobile/src/config/store.ts）
pub const KEY_HUB_URL: &str = "mojito.hubUrl";
pub const KEY_TOKEN: &str = "mojito.token";
