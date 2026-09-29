// 网页开发模式：同步读写 localStorage
export const FONT_SCALE_KEY = 'mojito.fontScale'
export const readFontScaleSync = () => window.localStorage.getItem(FONT_SCALE_KEY)
export const writeFontScaleSync = (value: string) => window.localStorage.setItem(FONT_SCALE_KEY, value)

export const COLOR_SCHEME_KEY = 'mojito.colorScheme'
export const readColorSchemeSync = () => window.localStorage.getItem(COLOR_SCHEME_KEY)
export const writeColorSchemeSync = (value: string) => window.localStorage.setItem(COLOR_SCHEME_KEY, value)

export const LANGUAGE_KEY = 'mojito.language'
export const readLanguageSync = () => window.localStorage.getItem(LANGUAGE_KEY)
export const writeLanguageSync = (value: string) => window.localStorage.setItem(LANGUAGE_KEY, value)
