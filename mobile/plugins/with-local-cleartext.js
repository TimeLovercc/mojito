// 只对本机地址放开明文 HTTP：模拟器或真机经 adb reverse 连假服务器（http://localhost:8788）时用。
// 其余域名仍然只能走 HTTPS（hub 经 HTTPS 入口访问，如 tailscale serve、Cloudflare Tunnel）。
const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`

module.exports = function withLocalCleartext(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), XML)
      return cfg
    },
  ])
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0]
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return cfg
  })
}
