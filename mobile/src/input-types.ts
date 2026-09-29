import type { NativeSyntheticEvent, TextInputKeyPressEventData, TextStyle } from 'react-native'

// 电脑输入框额外的属性：自动长高的样式、Enter 发送
export type DesktopInputProps = {
  style?: TextStyle
  // 网页 <textarea> 的 rows：默认 2 行，空着也有两行高
  numberOfLines?: number
  onKeyPress?: (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void
}
