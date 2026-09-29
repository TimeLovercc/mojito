import type { ReactNode } from 'react'
import { View } from 'react-native'
import { hoverGroup, hoverMeta } from '../web-data'

// 悬停才出现的元信息（时间、来源，docs/desktop-v2.md 原则 4）：外层用 hoverGroup 标记，
// 鼠标移上去 100ms 后淡入，键盘聚焦到组里时也显示（:focus-within，见 desktop-css）。
// always=true 时常驻（最后一条回复、带撤销的消息；"按了会怎样"和撤销本身永远常驻，不要放进来）
export function HoverMeta({ children, always }: { children: ReactNode; always: boolean }) {
  if (always) return <View>{children}</View>
  return <View {...hoverMeta}>{children}</View>
}

export { hoverGroup }
