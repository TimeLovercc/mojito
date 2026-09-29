import type { Pwa } from './pwa'

// 网页版（PWA）：只有 /app/ 构建里的 pwa-boot.js 会设 window.__MOJITO_PWA__（docs/api.md "app 端约定"）。
// Mac app（Tauri）和开发用的 expo start --web 都没有它，为 null；不能用 Platform.OS === 'web' 判断
const boot = (window as Window & { __MOJITO_PWA__?: { build: string } }).__MOJITO_PWA__

// iOS 设备：UA 含 iPhone / iPad；iPadOS 默认用桌面 UA（Macintosh），靠多点触控区分
const ua = navigator.userAgent
const ios = /iPhone|iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
// 从主屏图标打开（standalone）；iOS 老版本只有 navigator.standalone
const standalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const pwa: Pwa | null = boot === undefined ? null : { build: boot.build, ios, standalone }
