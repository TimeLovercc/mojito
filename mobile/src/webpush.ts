import { hubRequest } from './api/client'
import type { HubConfig } from './config/store'
import { trackAction } from './usage'

// 网页版 Web Push（docs/api.md "app 端约定"）。只由 *.web.tsx 在 pwa !== null 时调用，原生端不打包进来。
// 一台设备只开一个推送通道：装了安卓 APK 或 Mac 版的设备不在浏览器里开

export const SW_URL = '/app/sw.js'
export const SW_SCOPE = '/app/'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function vapidKey(hub: HubConfig): Promise<Uint8Array<ArrayBuffer>> {
  const res = await hubRequest<{ public_key: string }>(hub, 'GET', '/webpush/vapid-public-key')
  return fromBase64Url(res.public_key)
}

// 订阅是不是用当前这把 VAPID 公钥登记的（私钥换过就不是，要用户重新点一次）
export function sameKey(sub: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const own = sub.options.applicationServerKey
  if (own === null) return false
  const a = new Uint8Array(own)
  return a.length === key.length && a.every((v, i) => v === key[i])
}

export async function registerSubscription(hub: HubConfig, sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const keys = json.keys as Record<string, string>
  await hubRequest(hub, 'POST', '/webpush/subscriptions', { endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
}

// 关推送、清令牌都走这里：先 unsubscribe，再告诉 hub 删掉，最后记 push_disable
export async function disablePush(hub: HubConfig, sub: PushSubscription): Promise<void> {
  await sub.unsubscribe()
  await hubRequest(hub, 'POST', '/webpush/subscriptions/delete', { endpoint: sub.endpoint })
  trackAction('push_disable', null)
}

// 当前这台设备的订阅（没开过就是 null）
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}
