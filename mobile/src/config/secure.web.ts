import { tauri } from '../tauri'

// 网页端：Mac app（Tauri）里走 desktop 提供的钥匙串命令 secret_get / secret_set / secret_remove；
// 普通浏览器（对着假服务器开发）没有 __TAURI__，存 localStorage。
// desktop 的 Rust 轮询 /pulse 也从这两个 key（mojito.hubUrl / mojito.token）读，名字不能改。
const t = tauri
export const secure =
  t === null
    ? {
        get: async (key: string) => window.localStorage.getItem(key),
        set: async (key: string, value: string) => window.localStorage.setItem(key, value),
        remove: async (key: string) => window.localStorage.removeItem(key),
      }
    : {
        get: (key: string) => t.core.invoke<string | null>('secret_get', { key }),
        set: (key: string, value: string) => t.core.invoke<void>('secret_set', { key, value }),
        remove: (key: string) => t.core.invoke<void>('secret_remove', { key }),
      }
