import { pwa } from '../pwa'
import { secure } from './secure'

export type HubConfig = { hubUrl: string; token: string }
// hub 为 null：还没在系统页填；orcaUrl 为 null：还没填"去 Orca"链接。
export type AppConfig = { hub: HubConfig | null; orcaUrl: string | null }

const KEYS = { hubUrl: 'mojito.hubUrl', token: 'mojito.token', orcaUrl: 'mojito.orcaUrl' } as const

export async function loadConfig(): Promise<AppConfig> {
  // 网页版（PWA）：hub 就是页面同源，地址固定取 location.origin 不存储，只存令牌；没有"去 Orca"
  if (pwa !== null) {
    const token = await secure.get(KEYS.token)
    return { hub: token === null ? null : { hubUrl: window.location.origin, token }, orcaUrl: null }
  }
  const [hubUrl, token, orcaUrl] = await Promise.all([secure.get(KEYS.hubUrl), secure.get(KEYS.token), secure.get(KEYS.orcaUrl)])
  const hub = hubUrl !== null && token !== null ? { hubUrl, token } : null
  return { hub, orcaUrl }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (pwa !== null) {
    if (config.hub === null) await secure.remove(KEYS.token)
    else await secure.set(KEYS.token, config.hub.token)
    return
  }
  if (config.hub === null) {
    await secure.remove(KEYS.hubUrl)
    await secure.remove(KEYS.token)
  } else {
    await secure.set(KEYS.hubUrl, config.hub.hubUrl)
    await secure.set(KEYS.token, config.hub.token)
  }
  if (config.orcaUrl === null) await secure.remove(KEYS.orcaUrl)
  else await secure.set(KEYS.orcaUrl, config.orcaUrl)
}
