// FCM 需要 Firebase 的 google-services.json。它永不入库：prebuild 时从仓库外
// MOJITO_GOOGLE_SERVICES_JSON（mobile/.env）指向的文件拷进 android/app/，并接上 Google Services gradle 插件。
// 变量没设或文件不存在就让 prebuild 失败（只在 prebuild 时读，网页版不需要）。
const fs = require('fs')
const path = require('path')
const { withDangerousMod, withProjectBuildGradle, withAppBuildGradle } = require('expo/config-plugins')

const CLASSPATH = "classpath('com.google.gms:google-services:4.4.2')"
const APPLY = 'apply plugin: "com.google.gms.google-services"'

function withCopy(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const SOURCE = process.env.MOJITO_GOOGLE_SERVICES_JSON
      if (SOURCE === undefined || SOURCE === '') {
        throw new Error('MOJITO_GOOGLE_SERVICES_JSON 未设置（mobile/.env）：指向仓库外的 google-services.json。见 mobile/README.md "FCM 推送"。')
      }
      if (!fs.existsSync(SOURCE)) {
        throw new Error(
          `缺少 ${SOURCE}。到 Firebase 控制台 → 项目设置 → 你的应用（Android，包名 ${cfg.android.package}）下载 google-services.json 放到这里，chmod 600。见 mobile/README.md "FCM 推送"。`,
        )
      }
      const info = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
      const packages = info.client.map((c) => c.client_info.android_client_info.package_name)
      if (!packages.includes(cfg.android.package)) {
        throw new Error(`${SOURCE} 里没有包名 ${cfg.android.package} 的应用（有：${packages.join(', ')}）`)
      }
      fs.copyFileSync(SOURCE, path.join(cfg.modRequest.platformProjectRoot, 'app', 'google-services.json'))
      return cfg
    },
  ])
}

function withClasspath(config) {
  return withProjectBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents
    if (gradle.includes('com.google.gms:google-services')) return cfg
    const deps = /buildscript\s*\{[\s\S]*?dependencies\s*\{/
    if (!deps.test(gradle)) throw new Error('android/build.gradle 里没有 buildscript.dependencies 块')
    cfg.modResults.contents = gradle.replace(deps, (m) => `${m}\n    ${CLASSPATH}`)
    return cfg
  })
}

function withApply(config) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents
    if (gradle.includes(APPLY)) return cfg
    cfg.modResults.contents = `${gradle}\n${APPLY}\n`
    return cfg
  })
}

module.exports = function withGoogleServices(config) {
  return withApply(withClasspath(withCopy(config)))
}
