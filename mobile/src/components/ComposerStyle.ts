import { StyleSheet } from 'react-native'
import { colors, isDark, overlay, shadow } from '../theme'

// 电脑密度下的输入卡（docs/desktop-v2.md 控件·输入卡）：对话、笔记共用。手机仍用各自原来的样式。
// 卡片内边距 8、圆角 14；浅色白底 + composer 阴影，深色 raised；发送键 32 正圆，禁用时浅底灰箭头（不用透明度）
export const composerD = StyleSheet.create({
  // 卡片本身上下两层：可选的芯片行（上下文"正在看：X ×"、待发缩略图），和主行 [图片 32][文字框][发送 32]
  card: {
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: isDark ? colors.raised : colors.card,
    boxShadow: shadow.composer,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: overlay.fill },
})

export const sendArrow = (enabled: boolean) => (enabled ? colors.onBrand : colors.tx3)
