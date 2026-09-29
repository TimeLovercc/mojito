import { useFonts } from 'expo-font'
import { FONTS } from './font-files'
import { pwa } from './pwa'

// 网页版（PWA）：直接插 @font-face，不等 expo-font 的 fontfaceobserver。
// iPad 主屏 app 的 UA 既不像 iPad 也不像 Safari，expo-font 会去等 fontfaceobserver，在 WebKit 上要等满 12 秒超时（白屏）；
// 插入的规则和 expo-font 在 Safari 上走的是同一条路（design.md 8.8）。Mac app 和开发网页照旧用 useFonts
function injectFontFaces(): void {
  const style = document.createElement('style')
  style.id = 'mojito-fonts'
  style.textContent = Object.entries(FONTS)
    .map(([family, src]) => {
      // 网页构建里字体模块就是文件地址（/app/assets/…ttf）
      if (typeof src !== 'string') throw new Error(`字体 ${family} 不是地址：${JSON.stringify(src)}`)
      return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(src)});font-display:auto}`
    })
    .join('\n')
  document.head.appendChild(style)
}

function usePwaFonts(): [boolean, Error | null] {
  return [true, null]
}

if (pwa !== null) injectFontFaces()

export const useAppFonts: () => [boolean, Error | null] = pwa === null ? () => useFonts(FONTS) : usePwaFonts
