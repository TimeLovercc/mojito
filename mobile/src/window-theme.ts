import { tauri } from './tauri'
import type { ColorSchemeSetting } from './theme'

// Mac app 的窗口深浅色跟随 app 的设置（docs/desktop-v2.md #14）：desktop 的 set_theme 同时改主窗口和菜单栏面板，
// 并记下来，下次启动建窗口时就带上。启动时和用户改配色时各调一次；不在 Mac app 里什么都不做
export function syncWindowTheme(scheme: ColorSchemeSetting) {
  if (tauri === null) return
  tauri.core.invoke<null>('set_theme', { scheme }).catch((err: string) => {
    throw new Error(`窗口深浅色没设上：${err}`)
  })
}
