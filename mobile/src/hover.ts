import { useState } from 'react'

// 悬停状态（只有电脑上会触发）：给要在悬停时换边框或明显加深底色的控件用，展开到 Pressable 上。
// 一般的行只叠一层浅灰，用 web-data 的 hoverRow 就够（desktop-css.web.ts）
export function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false)
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }]
}
