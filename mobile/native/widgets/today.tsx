import { requestWidgetUpdate } from 'react-native-android-widget'
import { hubRequest } from '../../src/api/client'
import { readCache, writeCache } from '../../src/cache'
import type { Today } from '../../src/api/types'
import { loadConfig } from '../../src/config/store'
import { t } from '../../src/i18n'
import { BigWidget } from './BigWidget'
import { TodayWidget, type TodayState } from './TodayWidget'

export const TODAY_WIDGET = 'Today'
export const BIG_WIDGET = 'Big'
export const NOTE_WIDGET = 'Note'

// 和 app 的"今天"页共用 GET /today 的缓存（src/cache.ts），widget 不另存一份。
export async function cachedToday(): Promise<TodayState> {
  const config = await loadConfig()
  if (config.hub === null) return { kind: 'empty', reason: t('打开 Mojito，在"系统"页填 hub 地址和令牌') }
  const cached = await readCache<Today>('/today')
  if (cached === null) return { kind: 'empty', reason: t('还没有数据，打开 Mojito 刷新一次') }
  return { kind: 'ready', today: cached.data, fetchedAt: cached.fetchedAt }
}

// 向 hub 取新的 /today 写进缓存。拿不到就抛出，widget 继续显示缓存（带"数据来自"）。
export async function fetchToday(): Promise<TodayState> {
  const config = await loadConfig()
  if (config.hub === null) return cachedToday()
  const fresh = await hubRequest<Today>(config.hub, 'GET', '/today')
  const entry = await writeCache('/today', fresh)
  return { kind: 'ready', today: entry.data, fetchedAt: entry.fetchedAt }
}

// 读 /today 的两个 widget 按名字画
export function renderToday(widgetName: string, state: TodayState) {
  if (widgetName === TODAY_WIDGET) return <TodayWidget state={state} />
  if (widgetName === BIG_WIDGET) return <BigWidget state={state} />
  throw new Error(`不是读 /today 的 widget：${widgetName}`)
}

async function drawAll(state: TodayState): Promise<void> {
  for (const name of [TODAY_WIDGET, BIG_WIDGET]) {
    await requestWidgetUpdate({ widgetName: name, renderWidget: () => renderToday(name, state) })
  }
}

// app 退到后台、收到推送时调用：先按缓存重画，再取新数据重画
export async function refreshTodayWidget(): Promise<void> {
  await drawAll(await cachedToday())
  await drawAll(await fetchToday())
}
