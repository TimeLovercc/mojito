import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// 贴底的输入框用：键盘收起时留出手势条 / 导航栏的高度；键盘弹出时由 KeyboardAvoidingView 抬起，不再额外留白。
// 不能把 insets.bottom 写在 KeyboardAvoidingView 的 paddingBottom 上：behavior="padding" 会覆盖它。
export function BottomInset({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return <View style={{ paddingBottom: keyboard ? 0 : insets.bottom }}>{children}</View>
}
