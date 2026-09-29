import { useLayoutEffect, useState, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import type { DesktopInputProps } from './input-types'
import { desktop, size } from './theme'

// 电脑（网页 / Mac app，电脑密度下）的输入框（docs/desktop-v2.md 控件·输入卡）：
// 文字行高 L = round(字号 × 1.47)，上下补齐到和 32 的按钮一样高、文字和按钮中心对齐；多行自动长高，
// 输入卡最高 min(240, 35vh)（卡片上下内边距各 8）；Enter 发送，Shift+Enter 换行，
// 输入法组字（拼音候选、keyCode 229）和长按回车重复时不发送
const LINE = Math.round(size.body * 1.47)
const PAD = Math.max(0, (32 - LINE) / 2)
const MIN = LINE + PAD * 2

export function useDesktopInput(text: string, onEnter: () => void, ref: RefObject<TextInput | null>): DesktopInputProps {
  const [height, setHeight] = useState(MIN)
  // react-native-web 的 TextInput 就是 <textarea>：先放成 auto 再量 scrollHeight，删字时才会变矮
  useLayoutEffect(() => {
    if (!desktop) return
    const node = ref.current as unknown as HTMLTextAreaElement | null
    if (node === null) return
    const max = Math.min(240, window.innerHeight * 0.35) - 16
    node.style.height = 'auto'
    const next = Math.min(max, Math.max(MIN, node.scrollHeight))
    node.style.height = `${next}px`
    setHeight(next)
  }, [text, ref])
  // 浏览器窄屏调试（非电脑密度）和手机一样：回车换行
  if (!desktop) return {}
  return {
    numberOfLines: 1,
    style: { height, minHeight: MIN, maxHeight: 224, lineHeight: LINE, paddingTop: PAD, paddingBottom: PAD },
    onKeyPress: (e) => {
      const k = e.nativeEvent as unknown as KeyboardEvent
      if (k.key !== 'Enter' || k.shiftKey || k.isComposing || k.keyCode === 229 || k.repeat) return
      e.preventDefault()
      onEnter()
    },
  }
}
