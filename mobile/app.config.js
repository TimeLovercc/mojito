// app.json 之外、每个部署者各不相同的值从环境变量读（mobile/.env，见 mobile/.env.example；Expo CLI 会自动加载）。
// 缺了就报错，不猜默认值。
//   EXPO_PUBLIC_MOJITO_TIMEZONE  你的 IANA 时区（和 hub 的 MOJITO_TIMEZONE 相同），打进 JS 包
//   MOJITO_OTA=eas               空中更新走你自己的 EAS 项目：MOJITO_EAS_OWNER、MOJITO_EAS_PROJECT_ID 必填
//   MOJITO_OTA=none              不接空中更新（JS 改动靠重新打 APK；网页版刷新即生效）
// 网页版（PWA）构建：scripts/build-pwa.mjs 只在子进程里设 MOJITO_WEB_BASE_URL=/app，这时加 experiments.baseUrl，
// 并且不带任何空中更新配置（updates、EAS projectId、owner 都不能进网页产物，见 docs/api.md "内容约束"），也不需要 MOJITO_OTA。
function required(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} 未设置（写进 mobile/.env，见 mobile/.env.example）`)
  return value
}

module.exports = ({ config }) => {
  required('EXPO_PUBLIC_MOJITO_TIMEZONE')
  if (process.env.MOJITO_WEB_BASE_URL !== undefined) {
    const { updates, ...rest } = config
    return { ...rest, experiments: { ...rest.experiments, baseUrl: process.env.MOJITO_WEB_BASE_URL } }
  }
  const ota = required('MOJITO_OTA')
  if (ota === 'none') return { ...config, updates: { ...config.updates, enabled: false } }
  if (ota !== 'eas') throw new Error(`MOJITO_OTA 只能是 eas 或 none，现在是 ${ota}`)
  const projectId = required('MOJITO_EAS_PROJECT_ID')
  return {
    ...config,
    owner: required('MOJITO_EAS_OWNER'),
    updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` },
    extra: { ...config.extra, eas: { projectId } },
  }
}
