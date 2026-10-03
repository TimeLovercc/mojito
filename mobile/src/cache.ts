import AsyncStorage from '@react-native-async-storage/async-storage'
import { bundleId } from './bundle'

// 每个 GET 路径缓存上次成功的响应，离线时拿来显示并标注"数据来自 <时间>"。
export type Cached<T> = { data: T; fetchedAt: string }

// 缓存按 JS 包分开：换了包（空中更新、Mac 新版本、网页版新构建）就不再读旧包存的缓存，启动时清掉。
// 新包可能改了响应结构（如 Project 加 overview），旧缓存喂给新代码会让页面崩掉
const PREFIX = `mojito.cache.${bundleId}:`
const ANY_PREFIX = /^mojito\.cache(\.[^:]+)?:/

export async function dropOldCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys()
  await AsyncStorage.multiRemove(keys.filter((k) => ANY_PREFIX.test(k) && !k.startsWith(PREFIX)))
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
