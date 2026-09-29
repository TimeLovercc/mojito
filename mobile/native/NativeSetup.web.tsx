import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { hubRequest, HubError } from '../src/api/client'
import type { HubRecord, NotifyKind, Settings } from '../src/api/types'
import { useConfig } from '../src/config/context'
import type { HubConfig } from '../src/config/store'
import { pwa, type Pwa } from '../src/pwa'
import { routeOf } from '../src/push-route'
import { useRefresh } from '../src/refresh'
import { colors, font, size } from '../src/theme'
import { useErrorToast } from '../src/toast'
import { pushSupported, registerSubscription, sameKey, SW_SCOPE, vapidKey } from '../src/webpush'
import { t } from '../src/i18n'

// 网页端挂在根 _layout 里。Mac app 和开发网页（pwa === null）什么都不做，和 NativeSetup.tsx 一样。
// 网页版（PWA，design.md 8.8、docs/api.md "app 端约定"）：
// 每次启动重新登记推送订阅（Service Worker 在 PwaGate.web.tsx 加载时就注册，引导页的"开启推送"要用）、按 SW 消息跳转或刷新、设角标；
// 回到前台比对 version.json 提示刷新、可见期间每 30 秒取 /pulse 并提示"刚收到"、10 分钟内冷启动回到原页面。
export function NativeSetup() {
  const { config } = useConfig()
  if (pwa === null || config.hub === null) return null
  return <PwaSetup app={pwa} hub={config.hub} />
}

const BASE = '/app'
const PULSE_MS = 30000
const CURSOR_KEY = 'mojito.pulseCursor'
const ROUTE_KEY = 'mojito.lastRoute'
const RESTORE_MS = 10 * 60 * 1000
// 冷启动时的地址：从主屏图标进来是 /app/，点通知进来是 /app/open?…（这时不恢复）
const launchPath = window.location.pathname

type PulseRecord = HubRecord & { category: NotifyKind | null }
type Pulse = { cursor: string; records: PulseRecord[]; more: boolean; counts: { due_today: number; needs_you: number } }

// /app/open?… → /open?…（expo-router 的路径不带 /app 前缀）
function appPath(url: string): string {
  return url.startsWith(`${BASE}/`) ? url.slice(BASE.length) : url
}

// 每次启动：已授权且订阅是这把公钥登记的，就再 POST 一次（接口幂等；iOS 没有 pushsubscriptionchange，靠这一步兜住）。
// 不一致或没订阅，"通知"页会显示"重新开启推送"
function useResubscribe(hub: HubConfig) {
  const showError = useErrorToast()
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== 'granted') return
    Promise.all([navigator.serviceWorker.ready, vapidKey(hub)])
      .then(async ([reg, key]) => {
        const sub = await reg.pushManager.getSubscription()
        if (sub !== null && sameKey(sub, key)) await registerSubscription(hub, sub)
      })
      .catch((err: Error) => showError(t('推送登记失败'), err))
  }, [hub])
}

// 角标 = 等你拍板总数（/pulse 的 counts.needs_you，和 /today 同一个数），为 0 时清除
function setBadge(count: number) {
  if (!('setAppBadge' in navigator) || !pushSupported() || Notification.permission !== 'granted') return
  const done = count === 0 ? navigator.clearAppBadge() : navigator.setAppBadge(count)
  done.catch((err: Error) => console.warn(`角标没设上：${err.message}`))
}

function PwaSetup({ app, hub }: { app: Pwa; hub: HubConfig }) {
  const router = useRouter()
  const pathname = usePathname()
  const { bump } = useRefresh()
  const showError = useErrorToast()
  const insets = useSafeAreaInsets()
  const [newVersion, setNewVersion] = useState(false)
  const [received, setReceived] = useState<PulseRecord | null>(null)
  const pulling = useRef(false)

  useResubscribe(hub)

  // 取 /pulse，游标规则和 Mac 相同：第一次不给 after，只拿游标和计数；more 为 true 就接着取
  const pulse = async () => {
    if (pulling.current) return
    pulling.current = true
    try {
      const fresh: PulseRecord[] = []
      let cursor = window.localStorage.getItem(CURSOR_KEY)
      let page: Pulse
      do {
        const query = cursor === null ? '?limit=50' : `?after=${encodeURIComponent(cursor)}&limit=50`
        page = await hubRequest<Pulse>(hub, 'GET', `/pulse${query}`)
        window.localStorage.setItem(CURSOR_KEY, page.cursor)
        cursor = page.cursor
        fresh.push(...page.records)
      } while (page.more)
      setBadge(page.counts.needs_you)
      if (fresh.length === 0) return
      bump()
      // 和推送同一套开关：关掉的类型不提示
      const settings = await hubRequest<Settings>(hub, 'GET', '/settings')
      const shown = fresh.filter((r) => r.category !== null && settings.notify[r.category])
      if (shown.length > 0) setReceived(shown[shown.length - 1])
    } catch (err) {
      if (!(err instanceof Error)) throw err
      // 令牌失效要人处理；连不上或 hub 出错下次照常重试，游标不丢
      if (err instanceof HubError && (err.status === 401 || err.status === 403)) showError(t('令牌失效了，到"系统 → 更多 → 连接设置"重新填'), err)
      else console.warn(`/pulse 失败，下次再取：${err.message}`)
    } finally {
      pulling.current = false
    }
  }

  const checkVersion = () => {
    fetch(`${BASE}/version.json`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`version.json ${res.status}`)
        return res.json() as Promise<{ build: string }>
      })
      .then(async (v) => {
        if (v.build === app.build) return
        setNewVersion(true)
        const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
        if (reg !== undefined) await reg.update()
      })
      .catch((err: Error) => console.warn(`查新版本失败：${err.message}`))
  }

  // 前台：启动和每次回到前台查新版本、取 /pulse；可见期间每 30 秒取一次
  useEffect(() => {
    checkVersion()
    pulse()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') pulse()
    }, PULSE_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      checkVersion()
      pulse()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hub])

  // SW 发来的消息：收到推送就立即刷新；点了通知（app 已开着）就跳过去
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ type: 'push'; record_id: string } | { type: 'open'; url: string }>) => {
      if (e.data.type === 'push') {
        bump()
        pulse()
      } else if (e.data.type === 'open') {
        router.push(appPath(e.data.url))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [hub])

  // 记下最后停留的页面；10 分钟内冷启动（从主屏图标进来）就回到那里
  useEffect(() => {
    const saved = window.localStorage.getItem(ROUTE_KEY)
    if (saved === null || (launchPath !== `${BASE}/` && launchPath !== BASE)) return
    const last = JSON.parse(saved) as { path: string; at: number }
    if (Date.now() - last.at < RESTORE_MS && last.path !== '/') router.replace(last.path)
  }, [])
  useEffect(() => {
    if (pathname === '/open') return
    const path = appPath(window.location.pathname) + window.location.search
    window.localStorage.setItem(ROUTE_KEY, JSON.stringify({ path, at: Date.now() }))
  }, [pathname])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      const saved = window.localStorage.getItem(ROUTE_KEY)
      if (saved !== null) window.localStorage.setItem(ROUTE_KEY, JSON.stringify({ ...JSON.parse(saved), at: Date.now() }))
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  if (!newVersion && received === null) return null
  return (
    <View style={[styles.banners, { top: insets.top + 6 }]} pointerEvents="box-none">
      {newVersion ? (
        <Pressable style={styles.banner} onPress={() => window.location.reload()}>
          <Text style={styles.bannerText}>{t('有新版本 · 点此刷新')}</Text>
        </Pressable>
      ) : null}
      {received === null ? null : (
        <Pressable
          style={styles.banner}
          onPress={() => {
            setReceived(null)
            router.push(routeOf({ record_id: received.id, kind: received.kind, item_id: received.item_id }))
          }}
        >
          <Text style={styles.bannerText} numberOfLines={1}>
            {t('刚收到：{title}', { title: received.title })}
          </Text>
          <Pressable onPress={() => setReceived(null)} hitSlop={8}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  banners: { position: 'absolute', left: 12, right: 12, zIndex: 100, gap: 6, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 420,
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.brand,
  },
  bannerText: { ...font.semibold, fontSize: size.secondary, color: colors.onBrand, flex: 1 },
  close: { ...font.semibold, fontSize: size.title, color: colors.onBrand },
})
