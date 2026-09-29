import type { TauriApi } from './tauri-api'

// Mac app（Tauri）里有 window.__TAURI__；普通浏览器没有，为 null
export const tauri: TauriApi | null = (window as Window & { __TAURI__?: TauriApi }).__TAURI__ ?? null
