import { Platform } from 'react-native'

// react-native-web 的 dataSet → data-* 属性，给 desktop-css.web.ts 里的规则挂钩；原生端是空对象。
// RN 的类型里没有 dataSet，所以这里做成可以展开到任意组件上的普通对象。
function data(set: Record<string, string>): object {
  return Platform.OS === 'web' ? { dataSet: set } : {}
}

// 行和导航：鼠标悬停叠 hover、按下叠 pressed（docs/desktop-v2.md 线、叠加）
export const hoverRow = data({ hover: 'row' })
// Mac app 的窗口拖动区（顶栏整条、侧栏顶部）；带 tabindex 的按钮 Tauri 自动排除
export const dragRegion = data({ tauriDragRegion: 'deep' })
// 对话输入卡上方 24px 渐变遮罩
export const fadeTop = data({ fade: 'top' })
// 悬停才显示的元信息：组（外层）和元信息本身（src/desktop/HoverMeta.tsx）
export const hoverGroup = data({ hovergroup: 'on' })
export const hoverMeta = data({ hovermeta: 'on' })
