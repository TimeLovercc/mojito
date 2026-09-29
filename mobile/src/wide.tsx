import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { useFocusEffect, usePathname, useRouter } from 'expo-router'
import { WIDE_MIN } from './theme'
import { tauri } from './tauri'

// 宽屏布局（design.md 8.4，Mac app / 网页）：底部页签换成左侧边栏，列表和详情并排，对话是独立整页。
// 只在网页端、窗口够宽时生效；手机（原生）永远是窄屏布局。
// 浏览器里还要够高：横屏 iPhone（网页版）够宽但矮，仍用窄屏布局；Mac app 不看高度

export function useWide(): boolean {
  const { width, height } = useWindowDimensions()
  return Platform.OS === 'web' && width >= WIDE_MIN && (tauri !== null || height >= 600)
}

// 宽屏跳到对话页时自动带上的"正在看"：事项、项目或信息流卡片
export type Subject = { kind: 'item' | 'project' | 'card'; id: string; title: string }

type WideState = {
  subject: Subject | null
  setSubject: Dispatch<SetStateAction<Subject | null>>
}

const WideContext = createContext<WideState | null>(null)

export function WideProvider({ children }: { children: ReactNode }) {
  const [subject, setSubject] = useState<Subject | null>(null)
  return <WideContext.Provider value={{ subject, setSubject }}>{children}</WideContext.Provider>
}

function useWideState(): WideState {
  const ctx = useContext(WideContext)
  if (ctx === null) throw new Error('useWideState 必须在 WideProvider 内使用')
  return ctx
}

// 页面获得焦点时登记自己正在看的东西，失去焦点时撤掉（页签切走、推入详情页都算失去焦点）
export function useChatSubject(subject: Subject | null) {
  const { setSubject } = useWideState()
  const key = subject === null ? null : `${subject.kind}:${subject.id}:${subject.title}`
  useFocusEffect(
    useCallback(() => {
      // 数据还没到时不登记
      if (subject === null) return
      setSubject(subject)
      // 只撤掉自己登记的：下一个页面可能先获得焦点
      return () => setSubject((cur) => (cur === subject ? null : cur))
    }, [key]),
  )
}

// 宽屏的对话是独立整页（design.md 8.4 用户反馈修订）：侧边栏"对话"、顶栏"对话"、⌘J 都走这里。
// 在对话页就返回；在别的页就进对话页并带上当前页正在看的东西（"正在看：…"）
export function useToggleChat(): () => void {
  const { subject } = useWideState()
  const router = useRouter()
  const path = usePathname()
  return () => {
    if (path === '/chat') {
      if (router.canGoBack()) router.back()
      else router.replace('/')
      return
    }
    router.push(subject === null ? '/chat' : { pathname: '/chat', params: { kind: subject.kind, id: subject.id, title: subject.title } })
  }
}

// 窗口内快捷键（只在网页 / Mac app）：⌘N 笔记（聚焦输入框），⌘J 开关对话页
export function useShortcuts() {
  const router = useRouter()
  const toggleChat = useToggleChat()
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        router.navigate({ pathname: '/notes', params: { focus: String(Date.now()) } })
      } else if (k === 'j') {
        e.preventDefault()
        toggleChat()
      }
    }
    // 捕获阶段监听：react-native-web 的输入框会 stopPropagation，焦点在输入框里时 ⌘J / ⌘N 也要生效
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [router, toggleChat])
}
