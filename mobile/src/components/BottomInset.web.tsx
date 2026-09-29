import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardOpen } from '../viewport'

// 网页端贴底的输入框：键盘收起时留出 Home 条的高度，弹出时不留（键盘由 src/viewport.web.ts 让出位置）；
// 窄屏也补上左右安全区（横屏 iPhone 的刘海）。电脑浏览器和 Mac app 的安全区都是 0，和原来一样
export function BottomInset({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardOpen()
  return <View style={{ paddingBottom: keyboard ? 0 : insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>{children}</View>
}
