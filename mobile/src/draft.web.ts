import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { pwa } from './pwa'

// 网页版（PWA）：iOS 随时可能回收主屏 app，对话和笔记没发出的草稿节流写进 localStorage，冷启动时恢复（design.md 8.8）。
// Mac app 和开发网页不落盘，和原生一样
const PREFIX = 'mojito.draft:'
const THROTTLE_MS = 500

function useStoredDraft(key: string): [string, Dispatch<SetStateAction<string>>] {
  const storageKey = PREFIX + key
  const [text, setText] = useState(() => {
    const saved = window.localStorage.getItem(storageKey)
    return saved === null ? '' : saved
  })
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text === '') window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, text)
    }, THROTTLE_MS)
    return () => clearTimeout(timer)
  }, [storageKey, text])
  return [text, setText]
}

function usePlainDraft(_key: string): [string, Dispatch<SetStateAction<string>>] {
  return useState('')
}

export const useDraft = pwa === null ? usePlainDraft : useStoredDraft
