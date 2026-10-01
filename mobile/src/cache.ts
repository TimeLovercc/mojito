import AsyncStorage from '@react-native-async-storage/async-storage'

// 每个 GET 路径缓存上次成功的响应，离线时拿来显示并标注"数据来自 <时间>"。
export type Cached<T> = { data: T; fetchedAt: string }

// 响应结构变了（比如 /today 加了 schedule、drafts、needs_you.projects，Record 加 attachments、card_id，Plan 加 revises，needs_you 加 feedback，Record 加 feedback_id，/today 加 overdue、days_until，Source 加 health）就把版本号加一：旧缓存不再读取，启动时清掉
const CACHE_VERSION = 13
const PREFIX = `mojito.cache.v${CACHE_VERSION}:`
const OLD_PREFIX = /^mojito\.cache(\.v\d+)?:/

export async function dropOldCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys()
  await AsyncStorage.multiRemove(keys.filter((k) => OLD_PREFIX.test(k) && !k.startsWith(PREFIX)))
}
const LAST_SYNC = 'mojito.lastSync'

export async function readCache<T>(path: string): Promise<Cached<T> | null> {
  const raw = await AsyncStorage.getItem(PREFIX + path)
  return raw === null ? null : (JSON.parse(raw) as Cached<T>)
}

export async function writeCache<T>(path: string, data: T): Promise<Cached<T>> {
  const entry = { data, fetchedAt: new Date().toISOString() }
  await AsyncStorage.multiSet([
    [PREFIX + path, JSON.stringify(entry)],
    [LAST_SYNC, entry.fetchedAt],
  ])
  return entry
}

export async function removeCache(path: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + path)
}

export function readLastSync(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNC)
}

export async function clearCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys()
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX) || k === LAST_SYNC))
}
