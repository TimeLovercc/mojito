// expo-updates 的 runtimeVersion 指纹（README "空中更新"）。npm scripts 不影响原生部分，不算进指纹。
const { SourceSkips } = require('@expo/fingerprint')

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
}
