// macOS 通知：/pulse 取到的新记录（点开跳到对应页面）、新版本装好（点开重启）。
use mac_notification_sys::{Notification, NotificationResponse};

const BUNDLE_ID: &str = "com.example.mojito";

pub fn init() {
    mac_notification_sys::set_application(BUNDLE_ID).expect("设置通知来源 app 失败");
}

// 每条通知一个线程：等用户点击（不点就一直挂着，线程很轻）
// sound：interrupt / digest 有声音，quiet 静默（同手机的通知渠道）
pub fn show(app: &tauri::AppHandle, title: String, body: String, path: String, sound: bool) {
    show_then(app, title, body, sound, move |app| crate::show_main(app, &path).unwrap());
}

// 点击通知后执行 on_click
pub fn show_then(
    app: &tauri::AppHandle,
    title: String,
    body: String,
    sound: bool,
    on_click: impl FnOnce(&tauri::AppHandle) + Send + 'static,
) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut notification = Notification::new();
        notification.title(&title).message(&body).wait_for_click(true);
        if sound {
            notification.default_sound();
        }
        let response = notification
            .send()
            .expect("发送 macOS 通知失败");
        if response == NotificationResponse::Click {
            on_click(&app);
        }
    });
}
