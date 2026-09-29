import { useCallback, useEffect, useReducer, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { hubRequest, HubError, ReadableError } from './api/client'
import { t } from './i18n'
import { readCache, removeCache, writeCache } from './cache'
import type { HubConfig } from './config/store'
import { useConfig } from './config/context'
import { useRefresh } from './refresh'

// 每个 GET 路径一份，放在模块里，所有页面共享：切页签、进出详情时立刻有数据，不闪空白。
type Entry = {
  data: unknown
  fetchedAt: string | null
  // live：这份数据是本次运行里从 hub 拿到的；false 表示来自 AsyncStorage
  live: boolean
  error: Error | null
  syncing: boolean
}

const store = new Map<string, Entry>()
const listeners = new Set<() => void>()

const EMPTY: Entry = { data: null, fetchedAt: null, live: false, error: null, syncing: false }

function entryOf(path: string): Entry {
  const e = store.get(path)
  return e === undefined ? EMPTY : e
}

function patch(path: string, change: Partial<Entry>) {
  store.set(path, { ...entryOf(path), ...change })
  for (const l of listeners) l()
}

// 换了 hub 后，内存里的旧数据也不再属于新 hub
export function clearMemory() {
  store.clear()
  for (const l of listeners) l()
}

async function sync(path: string, hub: HubConfig | null) {
  if (entryOf(path).syncing) return
  if (entryOf(path).data === null) {
    const cached = await readCache<unknown>(path)
    if (cached !== null && entryOf(path).data === null) patch(path, { data: cached.data, fetchedAt: cached.fetchedAt, live: false })
  }
  if (hub === null) {
    patch(path, { error: new ReadableError(t('还没设置 hub 地址和令牌，去"系统"页填写')) })
    return
  }
  patch(path, { syncing: true })
  try {
    const fresh = await hubRequest<unknown>(hub, 'GET', path)
    const entry = await writeCache(path, fresh)
    patch(path, { data: entry.data, fetchedAt: entry.fetchedAt, live: true, error: null, syncing: false })
  } catch (err) {
    if (!(err instanceof Error)) throw err
    // hub 回 404：对象确实不存在，清掉缓存
    if (err instanceof HubError && err.status === 404) {
      await removeCache(path)
      patch(path, { data: null, fetchedAt: null, live: false, error: err, syncing: false })
      return
    }
    patch(path, { error: err, syncing: false })
  }
}

// 启动时把四个页签要用的数据先取好，第一次切过去就有内容
export function prefetch(paths: string[], hub: HubConfig | null) {
  for (const path of paths) sync(path, hub)
}

export type HubView<T> = {
  data: T | null
  fetchedAt: string | null
  live: boolean
  error: Error | null
  // syncing：后台静默更新；pulling：用户下拉刷新
  syncing: boolean
  pulling: boolean
  pull: () => Promise<void>
  // 静默重取（轮询用），不显示下拉转圈
  refresh: () => Promise<void>
}

// 先显示已有数据（内存或缓存），后台向 hub 取新的，拿到后原地替换。
export function useHub<T>(path: string): HubView<T> {
  const { config } = useConfig()
  const { version } = useRefresh()
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [pulling, setPulling] = useState(false)

  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])

  const hub = config.hub
  // 刷新完成或做了动作之后，已挂载的页面都重新取
  useEffect(() => {
    if (version > 0) sync(path, hub)
  }, [version])

  useFocusEffect(
    useCallback(() => {
      sync(path, hub)
    }, [path, hub]),
  )

  const pull = useCallback(async () => {
    setPulling(true)
    await sync(path, hub)
    setPulling(false)
  }, [path, hub])

  const refresh = useCallback(() => sync(path, hub), [path, hub])

  const e = entryOf(path)
  return { data: e.data as T | null, fetchedAt: e.fetchedAt, live: e.live, error: e.error, syncing: e.syncing, pulling, pull, refresh }
}
