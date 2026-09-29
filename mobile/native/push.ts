import * as Notifications from 'expo-notifications'
import { hubRequest } from '../src/api/client'
import type { HubConfig } from '../src/config/store'
import { loadConfig } from '../src/config/store'
import type { Target } from '../src/push-route'
import { t } from '../src/i18n'

export { routeOf, type Target } from '../src/push-route'

// FCM data 消息（docs/api.md "FCM 推送"）：值都是字符串，item_id 为 null 时不带，reply 是 "true" / "false"。
// 标题键叫 headline：data 里如果有 title 键，expo-notifications 在后台会自己再弹一条（同一条推送显示两次）。
export type PushData = { record_id: string; headline: string; tier: string; kind: string; reply: string; item_id?: string }

const TIERS = ['interrupt', 'digest', 'quiet'] as const
type Tier = (typeof TIERS)[number]

export const REPLY_CATEGORY = 'reply'
const REPLY_ACTION = 'reply'

// 渠道 id 就是 tier。Android 渠道建好后重要性不能再改，要改只能换 id。
export async function ensureChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync('interrupt', {
    name: t('要紧'),
    description: t('时间敏感、当场能做点什么的事：响 + 震 + 横幅'),
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 250, 200, 250],
  })
  await Notifications.setNotificationChannelAsync('digest', {
    name: t('更新'),
    description: t('大多数更新：普通通知'),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  })
  await Notifications.setNotificationChannelAsync('quiet', {
    name: t('静默'),
    description: t('早上简报等：不响不震'),
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
  })
  await Notifications.setNotificationCategoryAsync(REPLY_CATEGORY, [
    {
      identifier: REPLY_ACTION,
      buttonTitle: t('回复'),
      textInput: { submitButtonTitle: t('发送'), placeholder: t('在这里直接回复…') },
      options: { opensAppToForeground: false },
    },
  ])
}

// data 消息缺字段就报错（hub 的 push.push_data 保证这几个键都在）
export function parsePush(data: Record<string, unknown>): PushData {
  for (const key of ['record_id', 'headline', 'tier', 'kind', 'reply']) {
    if (typeof data[key] !== 'string') throw new Error(`推送缺字段 ${key}：${JSON.stringify(data)}`)
  }
  return data as unknown as PushData
}

function asTier(tier: string): Tier {
  if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`推送的 tier 不认识：${tier}`)
  return tier as Tier
}

// hub 只发 data 消息，由 app 按 tier 选渠道显示。前台、后台、进程被杀时都走这里（后台任务）。
export async function present(data: PushData): Promise<void> {
  await ensureChannels()
  const target: Target = { record_id: data.record_id, kind: data.kind, item_id: data.item_id === undefined ? null : data.item_id }
  const reply = data.reply === 'true'
  await Notifications.scheduleNotificationAsync({
    identifier: data.record_id,
    content: { title: data.headline, data: target, ...(reply ? { categoryIdentifier: REPLY_CATEGORY } : {}) },
    trigger: { channelId: asTier(data.tier) },
  })
}

async function hubConfig(): Promise<HubConfig> {
  const config = await loadConfig()
  if (config.hub === null) throw new Error(t('还没设置 hub 地址和令牌'))
  return config.hub
}

// 通知里的"回复"：发到对话，item_id 固定 null（docs/api.md）。失败时换成一条说明失败的通知，不悄悄丢掉。
export async function sendReply(response: Notifications.NotificationResponse): Promise<void> {
  const id = response.notification.request.identifier
  const body = response.userText === undefined ? '' : response.userText.trim()
  try {
    if (body === '') throw new Error(t('回复是空的'))
    await hubRequest(await hubConfig(), 'POST', '/chat', { body, item_id: null, project_id: null, attachment_ids: [], card_id: null })
    await Notifications.dismissNotificationAsync(id)
  } catch (err) {
    if (!(err instanceof Error)) throw err
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title: t('回复没发出去'), body: `${err.message}\n${t('原话：{body}', { body })}`, data: response.notification.request.content.data },
      trigger: { channelId: 'digest' },
    })
    throw err
  }
}

export function isReply(response: Notifications.NotificationResponse): boolean {
  return response.actionIdentifier === REPLY_ACTION
}

export async function registerDevice(config: HubConfig): Promise<void> {
  const token = await Notifications.getDevicePushTokenAsync()
  await hubRequest(config, 'POST', '/devices', { fcm_token: token.data })
}
