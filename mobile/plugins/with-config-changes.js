// expo/expo#50386：Activity 因"配置变化"重建时（字体大小、显示大小、语言），expo-modules-core 不会重新注册
// 选图等 ActivityResultLauncher，之后调用一直失败到进程重启。把这些变化交给 MainActivity 自己处理、不重建，
// 就不会走到那条路径；React Native 会通过 onConfigurationChanged 收到新的字号和尺寸。
const { withAndroidManifest } = require('expo/config-plugins')

const EXTRA = ['fontScale', 'density', 'locale', 'layoutDirection']

module.exports = function withConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0]
    const main = app.activity.find((a) => a.$['android:name'] === '.MainActivity')
    if (main === undefined) throw new Error('AndroidManifest 里找不到 .MainActivity')
    const current = main.$['android:configChanges'].split('|')
    main.$['android:configChanges'] = [...current, ...EXTRA.filter((c) => !current.includes(c))].join('|')
    return cfg
  })
}
