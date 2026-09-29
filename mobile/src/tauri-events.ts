import { useEffect } from 'react'
import { useRouter, type Href } from 'expo-router'
import { useRefresh } from './refresh'
import { tauri } from './tauri'
import type { PulsePayload } from './tauri-api'
import { useToast } from './toast'
import { t } from './i18n'

// Mac app 的 Rust 发来的事件（desktop/README.md；只在 Tauri 里）：
// - navigate：通知点击、菜单栏面板"打开"之后主窗口跳到这个路径
// - pulse：每 30 秒拉 /pulse 的结果，有新记录就静默刷新当前页
// - panel-shown：菜单栏面板弹出前，面板刷新
// - auth-failed：hub 返回 401 / 403，提示重新填令牌
// menubar：这个窗口是菜单栏小面板，只刷新，不跳页
export function useTauriEvents(menubar: boolean) {
  const router = useRouter()
  const { bump } = useRefresh()
  const toast = useToast()
  useEffect(() => {
    const bridge = tauri
    if (bridge === null) return
    const offs = [
      bridge.event.listen<PulsePayload>('pulse', (e) => {
        if (e.payload.new_records > 0) bump()
      }),
      ...(menubar
        ? [bridge.event.listen<null>('panel-shown', () => bump())]
        : [
            bridge.event.listen<string>('navigate', (e) => router.push(e.payload as Href)),
            bridge.event.listen<number>('auth-failed', (e) => {
              toast(t('hub 不认这个令牌（{detail}），到系统页"更多"里重新填', { detail: e.payload }), true)
              router.push('/system')
            }),
          ]),
    ]
    return () => {
      for (const off of offs) off.then((stop) => stop())
    }
  }, [menubar, router, bump, toast])
}
