#!/usr/bin/env bash
# 本地打 release APK：expo prebuild 重建 android/，再 gradle assembleRelease；打好后推送一条"新安装包"通知。
# 产物放在 MOJITO_APK_DIR（仓库外），同时记下这个 APK 的 runtimeVersion 指纹
# 用法：npm run build:apk -- --message "<一句话>" --notes "改了什么1;改了什么2"
# 需要：JAVA_HOME（JDK 17）、ANDROID_HOME，以及 mobile/.env 里的 MOJITO_GOOGLE_SERVICES_JSON、
#       MOJITO_SIGNING_PROPERTIES、MOJITO_APK_DIR、MOJITO_SECRETS_DIR（见 mobile/.env.example）
set -euo pipefail
MESSAGE=""
NOTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --message) MESSAGE="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    *) echo "不认识的参数：$1" >&2; exit 1 ;;
  esac
done
[ -n "$MESSAGE" ] || { echo '缺 --message "<一句话说明>"' >&2; exit 1; }
[ -n "$NOTES" ] || { echo '缺 --notes "改了什么1;改了什么2"（给用户看的文字）' >&2; exit 1; }
: "${JAVA_HOME:?JAVA_HOME 未设置（JDK 17）}"
: "${ANDROID_HOME:?ANDROID_HOME 未设置}"

cd "$(dirname "$0")/.."
test -f .env || { echo "缺 mobile/.env（从 mobile/.env.example 复制后填好）" >&2; exit 1; }
set -a; . ./.env; set +a
: "${MOJITO_GOOGLE_SERVICES_JSON:?mobile/.env 里没有 MOJITO_GOOGLE_SERVICES_JSON}"
: "${MOJITO_SIGNING_PROPERTIES:?mobile/.env 里没有 MOJITO_SIGNING_PROPERTIES}"
: "${MOJITO_APK_DIR:?mobile/.env 里没有 MOJITO_APK_DIR}"
: "${MOJITO_SECRETS_DIR:?mobile/.env 里没有 MOJITO_SECRETS_DIR}"
test -f "$MOJITO_SIGNING_PROPERTIES" || { echo "缺少签名配置 $MOJITO_SIGNING_PROPERTIES" >&2; exit 1; }

npx expo prebuild --platform android --clean --no-install
# 只编 arm64-v8a（多数现代 Android 设备）
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)

# 复制到仓库外 MOJITO_APK_DIR：prebuild --clean 会删 android/，eas update 导出时会清空 dist/；
# 也不能在 mobile/.gitignore 里另加目录——.gitignore 算在 runtimeVersion 指纹里，一改指纹就变
mkdir -p "$MOJITO_APK_DIR"
APK="$MOJITO_APK_DIR/mojito-release.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"
AAPT=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)aapt
"$AAPT" dump badging "$APK" | head -1
# 记下这个 APK 的 runtimeVersion（fingerprint），之后对比它决定改动能否走空中更新
npm run --silent fingerprint > "$MOJITO_APK_DIR/mojito-release.runtime"
echo "runtimeVersion: $(cat "$MOJITO_APK_DIR/mojito-release.runtime")"
echo "APK: $APK"

BODY="$(printf '%s' "$NOTES" | tr ';' '\n' | sed 's/^ */· /')"
# 标题前缀由这里加；--message 里已经写了"新安装包："就不再重复
node scripts/notify.mjs --title "新安装包：${MESSAGE#新安装包：}" --body "$BODY
需要重装：把新的 mojito-release.apk 装到手机上（adb install -r，或用你自己的同步方式）"
