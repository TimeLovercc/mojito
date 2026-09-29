import { Appearance, Dimensions, Platform } from 'react-native'
import { tauri } from './tauri'
import { readColorSchemeSync, readFontScaleSync } from './config/font-scale'
import { finePointer } from './pointer'

// 颜色 token（design.md 8.2，对比稿 内部配色稿（未公开））：深色 B「冷静蓝」、浅色 C「浅色纸面」。
// 只有一个品牌色 brand + 三个状态色 ok / warn（逾期）/ bad（被忘了、失败），其余都是中性色。
// 页面只从这里取颜色。tx3 是最浅的文字色，只用于 12 号及以上的小字。
const DARK = {
  bg: '#0f1115',
  card: '#1a1d24',
  raised: '#252a33',
  line: '#2f3541',
  tx: '#eaedf3',
  tx2: '#aab1be',
  tx3: '#8a92a1',
  brand: '#8ea2ff',
  onBrand: '#0f1430',
  brandSoft: '#232b52',
  ok: '#4ade80',
  okSoft: '#14301f',
  warn: '#fbbf24',
  warnSoft: '#3a2e10',
  bad: '#f87171',
  badSoft: '#3b1a1c',
  tabbar: '#14171d',
  side: '#14171d',
}
const LIGHT: typeof DARK = {
  bg: '#f3f4f6',
  card: '#ffffff',
  raised: '#eceef2',
  line: '#e0e3e8',
  tx: '#15171c',
  tx2: '#4d5462',
  tx3: '#6b7280',
  brand: '#2f54eb',
  onBrand: '#ffffff',
  brandSoft: '#e6ebff',
  ok: '#15803d',
  okSoft: '#e3f5e9',
  warn: '#b45309',
  warnSoft: '#fdf0e1',
  bad: '#dc2626',
  badSoft: '#fde8e8',
  tabbar: '#ffffff',
  side: '#eceef2',
}

// 深浅色设置：跟随系统（默认）/ 深色 / 浅色。启动时定下用哪套；改设置或系统切换时重载一次 JS
export const COLOR_SCHEMES = ['system', 'dark', 'light'] as const
export type ColorSchemeSetting = (typeof COLOR_SCHEMES)[number]
function currentSchemeSetting(): ColorSchemeSetting {
  const stored = readColorSchemeSync()
  if (stored === null) return 'system'
  if (!(COLOR_SCHEMES as readonly string[]).includes(stored)) throw new Error(`深浅色设置不认识：${stored}`)
  return stored as ColorSchemeSetting
}
export const colorSchemeSetting = currentSchemeSetting()
export const isDark = colorSchemeSetting === 'system' ? Appearance.getColorScheme() !== 'light' : colorSchemeSetting === 'dark'

// 文字统一用系统中文字体（安卓思源黑体），按字重区分；Geist Mono 只用于时间和数字（design.md 8.1）
// 宽屏阈值（design.md 8.4）：网页端窗口至少这么宽时用电脑布局（src/wide.tsx）
export const WIDE_MIN = 900
// 电脑密度（docs/desktop-v2.md 的 dense）：网页端在 Mac app 里、或启动时窗口够宽就用，之后不随窗口变（样式在模块加载时创建）。
// 管字号、间距、控件尺寸、悬停、Enter 发送、桌面 CSS；380 宽的菜单栏面板因此也是电脑密度。布局宽窄另由 useWide() 管。
// 原生端永远是 false，手机样式不受影响。
// 触屏的 iPad / 横屏 iPhone（网页版）没有鼠标，按手机密度（src/pointer.web.ts）。
export const desktop = Platform.OS === 'web' && (tauri !== null || (Dimensions.get('window').width >= WIDE_MIN && finePointer))

// 电脑配色 B 中性′（docs/desktop-v2.md 顶部拍板，只用于电脑密度；手机仍是 B 冷静蓝 / C 浅色纸面）：
// 只换表面和中性文字，品牌色和 ok / warn / bad 不变。层次：侧栏 < 内容 bg < 卡片 card；输入卡深色用 raised。
// line 由文字色乘透明度得到（同 overlay.hair）
const DESK_LIGHT: typeof DARK = {
  ...LIGHT,
  bg: '#f3f3f0',
  card: '#ffffff',
  raised: '#ecece8',
  line: 'rgba(23,23,22,0.12)',
  tx: '#171716',
  tx2: '#52524e',
  tx3: '#6f6f6a',
  tabbar: '#ffffff',
}
const DESK_DARK: typeof DARK = {
  ...DARK,
  bg: '#151515',
  card: '#1f1f1e',
  raised: '#262625',
  line: 'rgba(236,236,234,0.10)',
  tx: '#ececea',
  tx2: '#a9a9a5',
  tx3: '#8c8c87',
  tabbar: '#151515',
}
export const colors = desktop ? (isDark ? DESK_DARK : DESK_LIGHT) : isDark ? DARK : LIGHT
// 侧栏底：Mac app 浅色是毛玻璃叠 #ecece8 α .65；深色不透明 #0c0c0c（深色时 desktop 关掉毛玻璃，保证层次）。
// 浏览器里没有毛玻璃，浅色用 #ecece8 实色
export const sideBg = isDark ? '#0c0c0c' : tauri === null ? '#ecece8' : 'rgba(236,236,232,0.65)'
// 菜单栏面板叠在 Popover 毛玻璃上的底色
export const popoverTint = isDark ? 'rgba(38,38,37,0.76)' : 'rgba(255,255,255,0.74)'

// 电脑上字体要写在每个 Text 上（react-native-web 给每个 Text 单独写 font，html 上设无效）：界面字苹方；
// mono 数字用 Geist Mono，混排串里的汉字回退到苹方；字重最重 600（docs/desktop-v2.md 字体）
const UI = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif'
const ui = desktop ? { fontFamily: UI } : {}
const monoFallback = desktop ? ', "PingFang SC", -apple-system, sans-serif' : ''
export const font = {
  regular: { ...ui, fontWeight: '400' },
  medium: { ...ui, fontWeight: '500' },
  semibold: { ...ui, fontWeight: '600' },
  bold: { ...ui, fontWeight: desktop ? '600' : '700' },
  mono: { fontFamily: `GeistMono_400Regular${monoFallback}` },
  monoMedium: { fontFamily: `GeistMono_500Medium${monoFallback}` },
} as const

// 字号开关：标准 1、大 1.15、特大 1.3；另外 Text 默认还会跟随安卓系统字体大小
export const FONT_SCALES = { standard: 1, large: 1.15, xlarge: 1.3 } as const
export type FontScaleName = keyof typeof FONT_SCALES
function currentScaleName(): FontScaleName {
  const stored = readFontScaleSync()
  if (stored === null) return 'standard'
  if (!(stored in FONT_SCALES)) throw new Error(`字号设置不认识：${stored}`)
  return stored as FontScaleName
}
export const fontScaleName = currentScaleName()
const k = FONT_SCALES[fontScaleName]

// 全 app 只有这 5 种字号：页面标题、卡片/事项标题、正文、次要、小字（时间、来源；最小 12）
// 电脑上更密：页面标题 24、标题 16、正文 15、次要 13、小字 12（用户的字号设置照样按比例放大）
const base = desktop
  ? { page: 24, title: 16, body: 15, secondary: 13, small: 12 }
  : { page: 26, title: 18, body: 16, secondary: 14, small: 12 }
export const size = {
  page: Math.round(base.page * k),
  title: Math.round(base.title * k),
  body: Math.round(base.body * k),
  secondary: Math.round(base.secondary * k),
  small: Math.round(base.small * k),
} as const

export const radii = { card: 14, button: 8, seg: 10, segItem: 7, chip: 14, tag: 10, input: 10 } as const

export const space = { gutter: 16, section: 14, inner: 13 } as const

// 电脑上的线和叠加（docs/desktop-v2.md 线、叠加、阴影）：都由文字色 tx 乘透明度得到，不新增色相
export function txAlpha(a: number): string {
  const n = parseInt(colors.tx.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
export const overlay = {
  hair: txAlpha(isDark ? 0.1 : 0.12),
  rowLine: txAlpha(0.07),
  hover: txAlpha(isDark ? 0.06 : 0.05),
  pressed: txAlpha(isDark ? 0.1 : 0.08),
  selected: txAlpha(isDark ? 0.12 : 0.09),
  fill: txAlpha(isDark ? 0.08 : 0.06),
}
export const shadow = {
  card: isDark ? 'inset 0 0 0 0.5px rgba(255,255,255,.08)' : '0 0 0 0.5px rgba(21,23,28,.12), 0 1px 3px rgba(0,0,0,.05)',
  composer: isDark ? 'inset 0 0 0 0.5px rgba(255,255,255,.10)' : '0 0 0 0.5px rgba(21,23,28,.14), 0 4px 20px rgba(0,0,0,.05)',
  popover: isDark ? '0 8px 24px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.20)' : '0 8px 24px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.08)',
}
