import { useFonts } from 'expo-font'
import { FONTS } from './font-files'

// 原生端就是 expo-font 的 useFonts（网页版见 fonts.web.ts）
export function useAppFonts(): [boolean, Error | null] {
  return useFonts(FONTS)
}
