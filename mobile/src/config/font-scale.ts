import * as SecureStore from 'expo-secure-store'

// 字号开关（系统页）：标准 / 大 / 特大。要在所有 StyleSheet 创建前同步读到，所以用 secure-store 的同步接口
export const FONT_SCALE_KEY = 'mojito.fontScale'
export const readFontScaleSync = () => SecureStore.getItem(FONT_SCALE_KEY)
export const writeFontScaleSync = (value: string) => SecureStore.setItem(FONT_SCALE_KEY, value)

// 深浅色（系统页）：跟随系统 / 深色 / 浅色，同样在样式创建前同步读
export const COLOR_SCHEME_KEY = 'mojito.colorScheme'
export const readColorSchemeSync = () => SecureStore.getItem(COLOR_SCHEME_KEY)
export const writeColorSchemeSync = (value: string) => SecureStore.setItem(COLOR_SCHEME_KEY, value)

// 界面语言（系统页 / hub 的 settings.language）：zh / en，模块顶层的 t() 要用，同样同步读
export const LANGUAGE_KEY = 'mojito.language'
export const readLanguageSync = () => SecureStore.getItem(LANGUAGE_KEY)
export const writeLanguageSync = (value: string) => SecureStore.setItem(LANGUAGE_KEY, value)
