import { useSyncExternalStore } from 'react'
import { pwa } from './pwa'

// 网页版（PWA）的键盘与可视区域（design.md 8.8）：iOS 弹键盘时不缩小页面，只缩小 visualViewport 并可能把页面往上推。
// 让 #root 的高度始终等于可视区域、并跟着它平移，页头就不会被顶出屏幕；收起键盘后把窗口滚回顶部，不留偏移。
// 只在 pwa !== null 时启用；Mac app 和开发网页不动
const KEYBOARD_MIN = 120

let keyboardOpen = false
const listeners = new Set<() => void>()

function sync(root: HTMLElement, vv: VisualViewport) {
  root.style.height = `${vv.height}px`
  root.style.transform = `translateY(${vv.offsetTop}px)`
  const open = document.documentElement.clientHeight - vv.height > KEYBOARD_MIN
  if (!open && keyboardOpen) window.scrollTo(0, 0)
  if (open === keyboardOpen) return
  keyboardOpen = open
  for (const l of listeners) l()
}

function install() {
  const root = document.getElementById('root')
  if (root === null) throw new Error('找不到 #root')
  const vv = window.visualViewport
  if (vv === null) throw new Error('浏览器没有 visualViewport')
  const update = () => sync(root, vv)
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()
}

if (pwa !== null) install()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 键盘弹出时隐藏底部页签、输入框不再留 Home 条的高度
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, () => keyboardOpen)
}
