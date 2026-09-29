// 网页里的 http(s) 请求（shell.js 换掉 window.fetch 后走这里，由 Rust 发出：页面来源是 tauri://localhost，hub 不带 CORS 头）。
// 不用 tauri-plugin-http：它每个请求新建一个客户端、一条新连接，也不设任何超时。页面一次并发十几个请求，
// 对 Funnel 同时做十几次 TLS 握手，Funnel 接不过来：握手卡 7–19 秒后被关（tls handshake eof），
// 页面上就是"error sending request"整批失败、请求挂住、加载圈一直转、图片出不来。
// 这里所有窗口共用一个客户端：对 hub 一条 HTTP/2 连接多路复用，不再成批握手；10 秒一次心跳，连接死了 15 秒内发现。
// 发请求出错（连不上、超时、连接断了，不含 HTTP 错误码）就换一个新客户端：睡眠唤醒、换网后下一次请求重新连，不复用死连接。
//
// 调用：invoke('hub_fetch', 打包的 Uint8Array)，[u32 大端 meta 长度][meta JSON][请求体]，
// meta = { method, url, headers: [[名, 值]], timeout_ms }；返回同样打包：[u32 head 长度][head JSON][响应体]，
// head = { status, headers: [[名, 值]] }。出错时 reject 中文字符串（含底层原因链）。
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::InvokeBody;

// hub：直接按 HTTP/2 连（Funnel 支持）。不预先说定的话，连接建好之前客户端不知道能多路复用，
// 并发请求会各自去连（实测 40 个并发要 22 秒）；说定了，并发请求都等同一条连接。
// 本机假服务器是明文 HTTP/1.1，另用一个普通客户端。
pub struct Http {
    hub: Mutex<reqwest::Client>,
    local: reqwest::Client,
}

fn hub_client() -> reqwest::Client {
    reqwest::Client::builder()
        .http2_prior_knowledge()
        .connect_timeout(Duration::from_secs(8))
        .http2_keep_alive_interval(Duration::from_secs(10))
        .http2_keep_alive_timeout(Duration::from_secs(5))
        .http2_keep_alive_while_idle(true)
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .unwrap()
}

pub fn state() -> Http {
    Http { hub: Mutex::new(hub_client()), local: reqwest::Client::new() }
}

enum Target {
    Hub,
    Local,
}

#[derive(Deserialize)]
struct Meta {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    timeout_ms: u64,
}

#[derive(Serialize)]
struct Head {
    status: u16,
    headers: Vec<(String, String)>,
}

// 同 capabilities 原来给 HTTP 插件的范围：hub（Tailscale 域名）和本机假服务器
fn target(url: &reqwest::Url) -> Result<Target, String> {
    match (url.scheme(), url.host_str()) {
        ("https", Some(host)) if host.ends_with(".ts.net") => Ok(Target::Hub),
        ("http", Some("localhost" | "127.0.0.1")) => Ok(Target::Local),
        _ => Err(format!("不允许访问 {url}（只允许 https://*.ts.net 和本机）")),
    }
}

fn split(bytes: &[u8]) -> (&[u8], &[u8]) {
    let len = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
    (&bytes[4..4 + len], &bytes[4 + len..])
}

fn pack(head: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + head.len() + body.len());
    out.extend_from_slice(&(head.len() as u32).to_be_bytes());
    out.extend_from_slice(head);
    out.extend_from_slice(body);
    out
}

fn chain(e: &reqwest::Error) -> String {
    let mut text = e.to_string();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        text += &format!(" <- {s}");
        source = s.source();
    }
    text
}

#[tauri::command]
pub async fn hub_fetch(http: tauri::State<'_, Http>, request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("hub_fetch 的参数要是打包好的 Uint8Array".into());
    };
    let (meta, body) = split(bytes);
    let meta: Meta = serde_json::from_slice(meta).map_err(|e| format!("hub_fetch 参数：{e}"))?;
    let url = reqwest::Url::parse(&meta.url).map_err(|e| format!("地址 {}：{e}", meta.url))?;
    let target = target(&url)?;
    let method = reqwest::Method::from_bytes(meta.method.as_bytes()).map_err(|e| format!("方法 {}：{e}", meta.method))?;
    let client = match target {
        Target::Hub => http.hub.lock().unwrap().clone(),
        Target::Local => http.local.clone(),
    };
    let mut builder = client.request(method, url).timeout(Duration::from_millis(meta.timeout_ms));
    for (name, value) in &meta.headers {
        builder = builder.header(name, value);
    }
    if !body.is_empty() {
        builder = builder.body(body.to_vec());
    }
    let result = async {
        let res = builder.send().await?;
        let status = res.status().as_u16();
        let headers = res
            .headers()
            .iter()
            .map(|(name, value)| (name.to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()))
            .collect();
        let body = res.bytes().await?;
        Ok::<_, reqwest::Error>((Head { status, headers }, body))
    }
    .await;
    match result {
        Ok((head, body)) => Ok(tauri::ipc::Response::new(pack(&serde_json::to_vec(&head).unwrap(), &body))),
        Err(e) => {
            if let Target::Hub = target {
                *http.hub.lock().unwrap() = hub_client();
            }
            Err(chain(&e))
        }
    }
}
