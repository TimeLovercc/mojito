// 加了 expo-updates / notifications / widget 之后，release 构建的 KSP 和 lint 会用光默认的
// 512m Metaspace（OutOfMemoryError: Metaspace）。prebuild 时把 gradle 的 JVM 内存调大。
const { withGradleProperties } = require('expo/config-plugins')

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1536m'

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const entry = cfg.modResults.find((p) => p.type === 'property' && p.key === 'org.gradle.jvmargs')
    if (entry === undefined) throw new Error('gradle.properties 里没有 org.gradle.jvmargs')
    entry.value = JVM_ARGS
    return cfg
  })
}
