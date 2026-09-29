import type { RefObject } from 'react'
import type { TextInput } from 'react-native'
import type { DesktopInputProps } from './input-types'

// 手机：回车换行、点发送键发，输入框高度由系统管（网页端见 input.web.ts）
export function useDesktopInput(_text: string, _onEnter: () => void, _ref: RefObject<TextInput | null>): DesktopInputProps {
  return {}
}
