import type { ColorProp } from 'react-native-android-widget'

// 颜色照 内部界面稿（未公开） 最后一屏的 .wg / .wg.note；字号与字体按 design.md 8.1：只用 26/18/16/14/12 五档，
// 中文用系统字体（不设 fontFamily），Geist Mono 只用于时间和数字（字体文件由 app.json 里 widget 插件的 fonts 打进 assets/fonts），
// 最浅的 tx3 不用于文字。
export const W = {
  bg: 'rgba(22, 22, 26, 0.9)' as ColorProp,
  border: 'rgba(255, 255, 255, 0.07)' as ColorProp,
  tx: '#e6e6e6' as ColorProp,
  tx2: '#9a9ca4' as ColorProp,
  sub: '#b0b3bb' as ColorProp,
  line2: '#353539' as ColorProp,
  amber: '#f59e0b' as ColorProp,
  red: '#ef4444' as ColorProp,
  raised: 'rgba(255, 255, 255, 0.08)' as ColorProp,
  btn: '#e6e6e6' as ColorProp,
  btnTx: '#111112' as ColorProp,
  mono: 'GeistMono_400Regular',
}

export const T = { card: 18, body: 16, minor: 14, small: 12 } as const
