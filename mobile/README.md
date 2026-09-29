# mojito mobile

Expo（SDK 57）+ expo-router + reanimated + lucide-react-native，Geist 字体随包打入。包名 `com.example.mojito`（fork 后改成你自己的，`app.json` 的 `android.package`）。
接口以 `../docs/api.md` 为准，界面照 `../docs/design.md` 第 8 节（v1 范围）。

- 底部五个页签：今天 / 计划 / 项目 / 信息流 / 笔记；右上角对话、心跳图标进"系统"；右下角浮动按钮只有"对话"。界面按 design.md 8.3 简化：
  - 笔记页一个输入框，笔记一律交给 Claude 整理（`needs_processing=true`、不选项目）；时间线点一条原地展开（变成的事项、撤销整理、删除）。
  - 等你拍板只有同意 / 不要；信息流卡片只有原文 / 问问；事项详情顶部"完成"+"⋯"（关闭 / 重新打开），记录默认折叠。
  - 对话不选项目、不分反馈；图片一个按钮（拍照 / 相册）。
- "系统"页：顶部"一切正常 / 有 N 个问题"点开看细节（运行、数据源、授权），7 天指标、刷新全部、现在复盘、去 Orca；设置、反馈、全部动态、版本在"更多"里。
- 时间：hub 给 UTC，app 一律按 `EXPO_PUBLIC_MOJITO_TIMEZONE`（和 hub 的 `MOJITO_TIMEZONE` 相同）显示。

## 配置

每个部署者自己的值都在 `mobile/.env`（不入库）：`cp .env.example .env` 后填好。`app.config.js` 在 `app.json` 之上读它，缺了就报错：

| 变量 | 什么时候要 | 说明 |
|---|---|---|
| `EXPO_PUBLIC_MOJITO_TIMEZONE` | 总是 | 你的 IANA 时区，打进 JS 包 |
| `MOJITO_OTA` | 总是 | `none`（不接空中更新）或 `eas`（再填 `MOJITO_EAS_OWNER`、`MOJITO_EAS_PROJECT_ID`） |
| `MOJITO_GOOGLE_SERVICES_JSON` | 打 APK | Firebase 的 `google-services.json`（仓库外） |
| `MOJITO_SIGNING_PROPERTIES` | 打 APK | release 签名配置 `signing.properties`（仓库外） |
| `MOJITO_APK_DIR` | 打 APK、空中更新 | APK 和它的 runtime 指纹放在哪（仓库外） |
| `MOJITO_SECRETS_DIR` | 打 APK、空中更新 | 放 `cards.env` 的目录，用来推送"新安装包 / app 已更新" |
- 每个 GET 的上次结果缓存在本机，拿不到新数据时显示缓存并标注"数据来自 <时间>"。

## 开发

```bash
npm install
MOCK_TOKEN=dev PORT=8788 MOCK_LANGUAGE=zh npm run mock   # 假服务器（时区和 app 一样读 mobile/.env 的 EXPO_PUBLIC_MOJITO_TIMEZONE；MOCK_LANGUAGE 是 zh 或 en，写进 settings.language），数据来自 ../docs/seed.example.json + mock/extra.json（虚构示例，由 examples/demo/demo_data.py 生成）
npm run web                            # Expo 网页模式，http://localhost:8081
```

网页模式在桌面浏览器里按手机宽度显示。打开后点右上角心跳图标进"系统"，填 hub 地址 `http://localhost:8788`、令牌 `dev`，保存。假服务器状态只在内存里，重启回到种子；刷新任务约 3 秒后 running、7 秒后 done。

不要用 `CI=1 npx expo start`：CI 模式下 Metro 不监听文件改动。

类型检查：`npm run typecheck`。

## 连接真实 hub

装好 APK 后在"系统"页填 hub 的 https 地址和 app 令牌（存 expo-secure-store，不打进包）。
"去 Orca"打开系统页里填的 Orca 链接，推荐填 `orca://`（打开 Orca mobile）。

## 打 release APK

一次性准备：

- 设好 `JAVA_HOME`（JDK 17）和 `ANDROID_HOME`（Android command-line tools），例如 Homebrew 的 `openjdk@17` 和 `android-commandlinetools`
- `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"`
- 自己生成一把 release keystore（`keytool -genkeypair ...`），和 `signing.properties`（storeFile、storePassword、keyAlias、keyPassword）一起放在仓库外，chmod 600，`mobile/.env` 的 `MOJITO_SIGNING_PROPERTIES` 指向它。**离线备份，永不入库**；丢了就不能覆盖升级已装的 app。

打包：

```bash
npm run build:apk -- --message "<一句话>" --notes "改了什么1;改了什么2"
# = scripts/build-apk.sh：expo prebuild --clean + gradlew assembleRelease（arm64-v8a），
#   产物放 $MOJITO_APK_DIR，最后推送一条"新安装包"通知
```

产物：`$MOJITO_APK_DIR/mojito-release.apk`（仓库外；从 `android/app/build/outputs/apk/release/` 复制出来，不入库）。`android/` 不入库，签名配置由 `plugins/with-release-signing.js` 在 prebuild 时写进 `build.gradle`。

装到手机（无线 adb）：`adb install -r "$MOJITO_APK_DIR/mojito-release.apk"`。

真机或模拟器连假服务器：`adb reverse tcp:8788 tcp:8788`，系统页填 `http://localhost:8788` + `dev`。
（`plugins/with-local-cleartext.js` 只对 localhost / 127.0.0.1 / 10.0.2.2 放开明文 HTTP，其余域名仍只走 HTTPS。）

本机有模拟器可做 release 自查：`$ANDROID_HOME/emulator/emulator -avd mojito-test -no-window -no-audio -gpu swiftshader_indirect`。

发布新 APK 前自查：切页签和进出详情时不能出现整页加载/空白/重排（数据先从内存或缓存显示，后台静默更新）。

## 原生部分（v3）：空中更新、FCM 推送、桌面 widget

代码在 `native/`（Android 专用文件带 `.android.tsx` 后缀，网页模式下是空实现）和 `plugins/`。入口是 `index.ts`：先在模块顶层注册推送后台任务和 widget 处理器，再加载 expo-router；根 `_layout` 里挂一个不渲染的 `<NativeSetup />`。

### 空中更新（EAS Update）

- `expo-updates`，channel `production`（写在 `app.json` 的 `updates.requestHeaders`），启动时后台检查，下载好的更新在**下次冷启动**生效。
- `runtimeVersion` 用 `fingerprint` 策略：按原生部分算指纹（`package.json` 里的原生依赖、`app.json` 原生配置、`plugins/`、各原生模块的代码）。一个 APK 只接收指纹相同的更新。
- **什么时候要重装 APK**：加/升级/删了带原生代码的依赖，改了 `app.json` 里除 JS 以外的配置（权限、图标、widget 尺寸、通知渠道图标……），改了 `plugins/` 下的文件。这时 `eas update` 发出去的包旧 APK 收不到（指纹不同，不会装错），要 `npm run build:apk` 重装。
- 其余（`app/`、`src/`、`native/` 下的 TS 代码、图片）都走 `npm run update -- --message "<说明>"`。
- 判断要不要重装：`npm run fingerprint` 打出当前指纹，和上次打 APK 时记下的 `$MOJITO_APK_DIR/mojito-release.runtime` 对比，不同就要重装。

一次性准备（需要你自己的 Expo 账号）：

```bash
npx eas-cli login                   # 你的 Expo 账号
npx eas-cli init                    # 在 expo.dev 建项目；把打印出的 projectId 和账号名写进 mobile/.env：
                                    #   MOJITO_OTA=eas、MOJITO_EAS_PROJECT_ID=<projectId>、MOJITO_EAS_OWNER=<账号名>
                                    #   （app.config.js 据此生成 owner、extra.eas.projectId、updates.url，app.json 里不写）
npm run build:apk -- --message "…" --notes "…"   # 装了 url 的 APK 才会检查更新；之后界面改动就不用重装了
npm run update -- --message "第一次空中更新"   # 首次会自动建 production 分支和 channel
```

`MOJITO_OTA=none` 时 `expo-updates` 在 APK 里处于关闭状态，只跑包里自带的 JS，一切照常。

### FCM 推送

- 用 `expo-notifications` + `expo-task-manager`。hub 只发 data 消息 `{record_id, item_id?, title, tier, kind, reply}`；app 的后台任务（进程被杀也会被唤醒）按 tier 显示本地通知。
- 三个通知渠道（渠道 id = tier）：`interrupt`"要紧"响+震+横幅、`digest`"更新"普通、`quiet`"静默"不响不震。Android 渠道建好后重要性改不了，要改只能换渠道 id。
- `reply=true` 的通知带"回复"输入框：app 不在前台时后台任务调 `POST /chat {body, item_id: null}`，成功就收起通知，失败换成一条"回复没发出去"的通知（带原话）。
- 点通知：有 `item_id` → 事项详情；`kind=chat` → 对话页 `/chat`；其余 → 动态。
- 每次启动（有 hub 设置时）拿 FCM token 调 `POST /devices`；token 轮换时再调。

一次性准备：

1. [Firebase 控制台](https://console.firebase.google.com) 新建你自己的项目 → 添加 Android 应用，包名和 `app.json` 的 `android.package` 一致 → 下载 `google-services.json`。
2. 放到仓库外，chmod 600，`mobile/.env` 的 `MOJITO_GOOGLE_SERVICES_JSON` 指向它。`plugins/with-google-services.js` 在 prebuild 时把它拷进 `android/app/`（不入库）；变量没设、文件不存在或包名不对就构建失败。
3. hub 那边：Firebase 项目设置 → 服务账号 → 生成私钥，放到服务器上，`MOJITO_FCM_CREDENTIALS` 指向它（`hub/deploy/install-secrets.sh`）。
4. 装好 APK 打开一次，允许通知。

### 桌面 widget

用 `react-native-android-widget`，样式见 `docs/design.md` 第 8 节。长按桌面 → 小组件 → Mojito。

- **Mojito 今天（大）**（4×6）：日期 +"今天到期 N · 等你拍板 N" → 今天到期（≤5，点开事项）→ 等你拍板（≤2，点开今天页）→ 被忘了（≤2，点开事项）→ 底部"笔记""对话"按钮。不放日程。
- **Mojito 今天**（3×2，可缩放）：今天到期前 3 条、下一个日程、等你拍板件数。
- 两个"今天"都读 app 的 `/today` 缓存；数据超过 1 小时没更新时标"数据来自 HH:MM"。系统每 30 分钟唤醒一次去取 `/today`，app 退到后台、收到推送时也会刷新。
- **Mojito 笔记**（2×2，原"记一笔"）：点开直达笔记页并聚焦输入框（`mojito://note` → `/notes?focus=1`）。
- 改 widget 的样子（`native/widgets/*.tsx`）走空中更新即可；改尺寸、名字、刷新间隔（`app.json`）要重装。

### app 图标

源图是 `docs/media/logo.svg`（彩色）和 `docs/media/logo-mono.svg`（单色剪影）。`scripts/make-icons.py` 从它们生成手机和桌面的全部图标，其中：`icon.png`（方形底）、`android-icon-foreground.png`（透明底，logo 在 66dp 安全圆内，自适应图标背景色见 `app.json`）、`android-icon-monochrome.png`（白色实心剪影，用于主题图标和通知栏小图标）、`widget-avatar.png`（widget 头部的小圆 logo）。换图后重跑两个脚本（网页版图标从 `assets/icon.png` 缩放），并重装 APK（图标是原生资源）。需要 rsvg-convert（librsvg）和 macOS 的 iconutil：

```bash
uv run --no-project --with pillow python scripts/make-icons.py \
  ../docs/media/logo.svg ../docs/media/logo-mono.svg assets ../desktop/src-tauri/icons
uv run --no-project --with pillow python scripts/make-pwa-icons.py
```

## 空中更新

```bash
npm run update -- --message "<一句话>" --notes "改了什么1;改了什么2"
```

- 要求 `mobile/.env` 里 `MOJITO_OTA=eas`。发布前比对指纹（`npm run fingerprint`）和 `$MOJITO_APK_DIR/mojito-release.runtime`，不同就拒绝：原生部分变了只能打新 APK。
- 发布成功后推送一条"app 已更新"通知（`scripts/notify.mjs`，令牌取 `$MOJITO_SECRETS_DIR/cards.env`）。`--message`、`--notes` 缺一个就报错。
- 注意：`eas update` 导出时会清空 `dist/`，所以 APK 不放那里；`mobile/.gitignore` 也算进指纹，改它会让指纹变。
