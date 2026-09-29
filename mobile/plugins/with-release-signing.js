// release 用仓库外的签名密钥：MOJITO_SIGNING_PROPERTIES（mobile/.env）指向的 signing.properties
// （storeFile、storePassword、keyAlias、keyPassword）。android/ 不入库，prebuild 时由本插件重建签名配置，
// 把这个路径写进 build.gradle；变量没设就让 prebuild 失败。
const { withAppBuildGradle } = require('expo/config-plugins')

const MARKER = '// mojito-release-signing'

const releaseSigning = (propsPath) => `
        release { ${MARKER}
            def propsFile = new File(${JSON.stringify(propsPath)})
            if (!propsFile.exists()) throw new GradleException("缺少签名配置 " + propsFile)
            def props = new Properties()
            propsFile.withInputStream { props.load(it) }
            storeFile new File(props.getProperty("storeFile"))
            storePassword props.getProperty("storePassword")
            keyAlias props.getProperty("keyAlias")
            keyPassword props.getProperty("keyPassword")
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents
    if (gradle.includes(MARKER)) return cfg
    const propsPath = process.env.MOJITO_SIGNING_PROPERTIES
    if (propsPath === undefined || propsPath === '') throw new Error('MOJITO_SIGNING_PROPERTIES 未设置（mobile/.env）：指向仓库外的 signing.properties')
    if (!gradle.includes('signingConfigs {')) throw new Error('build.gradle 里没有 signingConfigs 块')
    gradle = gradle.replace('signingConfigs {', `signingConfigs {${releaseSigning(propsPath)}`)
    const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/
    if (!releaseType.test(gradle)) throw new Error('build.gradle 的 release buildType 里没有 signingConfig signingConfigs.debug')
    cfg.modResults.contents = gradle.replace(releaseType, '$1signingConfig signingConfigs.release')
    return cfg
  })
}
