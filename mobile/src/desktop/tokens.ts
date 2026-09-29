import { size } from '../theme'

// 桌面 token 表 dt（docs/desktop-v2.md 桌面 token 表）：只给 src/desktop/ 下的新组件用，手机组件不取。
// 颜色仍取 theme.ts 的 colors / overlay / shadow（做法 A，拍板后改 token 即可）。
export const dt = {
  // 行高：字号 × 固定比例（阅读正文 16/26、段落 15/24、列表 15/22、说明 13/20、小字 12/16）
  line: {
    page: Math.round(size.page * 1.33),
    title: Math.round(size.title * 1.5),
    reading: Math.round(size.title * 1.625),
    body: Math.round(size.body * 1.47),
    para: Math.round(size.body * 1.6),
    secondary: Math.round(size.secondary * 1.54),
    small: Math.round(size.small * 1.33),
  },
  space: {
    pageX: 32,
    pageXNarrow: 24,
    pageTop: 24,
    section: 24,
    sectionHead: 8,
    cardV: 14,
    cardH: 16,
    rowV: 10,
    rowH: 16,
    sideX: 8,
    sideRowGap: 2,
    sideGroupGap: 16,
    chatTurn: 24,
    chatSame: 8,
  },
  height: { bar: 52, row1: 36, row2: 52, focusRow: 60, sideRow: 32, btnSm: 24, btnMd: 28, iconBtn: 28, pill: 20, seg: 24 },
  radius: { row: 8, btn: 6, card: 12, input: 14, popover: 12, pill: 10, thumb: 8, bubble: 12 },
  width: { side: 220, read: 720, chat: 720, aiText: 680, today: 1040, todayRight: 340, feedList: 360, projectList: 260, popover: 420 },
}
