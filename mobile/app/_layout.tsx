import { Platform, StyleSheet, View } from 'react-native'
import { useEffect, type ReactNode } from 'react'
import { Appearance } from 'react-native'
import { Stack, ThemeProvider, DarkTheme, DefaultTheme, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useAppFonts } from '../src/fonts'
import { NativeSetup } from '../native/NativeSetup'
import { ConfigProvider } from '../src/config/context'
import { RefreshProvider } from '../src/refresh'
import { ToastProvider } from '../src/toast'
import { colorSchemeSetting, colors, isDark } from '../src/theme'
import { reloadApp } from '../src/reload'
import { useUsageFlush } from '../src/usage'
import { useShortcuts, useWide, WideProvider } from '../src/wide'
import { Sidebar } from '../src/components/Sidebar'
import { installDesktopCss } from '../src/desktop-css'
import { syncWindowTheme } from '../src/window-theme'
import { useTauriEvents } from '../src/tauri-events'
import { tauri } from '../src/tauri'
import { useLanguageSync } from '../src/i18n/sync'

installDesktopCss()
syncWindowTheme(colorSchemeSetting)

const base = isDark ? DarkTheme : DefaultTheme
const theme = {
  ...base,
  colors: { ...base.colors, background: colors.bg, card: colors.bg, border: colors.line, text: colors.tx, primary: colors.brand },
}

export default function RootLayout() {
  // 字体随包打进去，不走网络
  // 跟随系统时，系统切换深浅色就重载一次，换用另一套颜色
  useEffect(() => {
    if (colorSchemeSetting !== 'system') return
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if ((colorScheme === 'dark') !== isDark) reloadApp()
    })
    return () => sub.remove()
  }, [])
  const [fontsLoaded, fontError] = useAppFonts()
  if (fontError !== null) throw fontError
  if (!fontsLoaded) return null
  return (
    <ThemeProvider value={theme}>
      <ConfigProvider>
        <ToastProvider>
          <RefreshProvider>
            <WideProvider>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <NativeSetup />
              <Shell>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="system" />
                  <Stack.Screen name="chat" />
                  <Stack.Screen name="feed" />
                  <Stack.Screen name="feedback/index" />
                  <Stack.Screen name="feedback/[id]" />
                  <Stack.Screen name="items/index" />
                  <Stack.Screen name="items/[id]" />
                  <Stack.Screen name="projects/[id]" />
                  <Stack.Screen name="cards/[id]" />
                  <Stack.Screen name="taste" />
                  <Stack.Screen name="subscriptions" />
                  <Stack.Screen
                    name="menubar"
                    options={{ contentStyle: { backgroundColor: tauri === null ? colors.card : 'transparent' } }}
                  />
                  <Stack.Screen name="notify" />
                  <Stack.Screen name="records/[id]" />
                  <Stack.Screen name="plans/[id]" />
                  <Stack.Screen name="note" />
                </Stack>
              </Shell>
            </WideProvider>
          </RefreshProvider>
        </ToastProvider>
      </ConfigProvider>
    </ThemeProvider>
  )
}

// 宽屏（Mac app / 宽的浏览器窗口）：左侧边栏 + 页面 + 右侧对话面板。
// 窄屏网页在桌面浏览器里按手机宽度居中显示；原生端就是全屏。
// 三个槽位固定，宽窄切换时页面（Stack）不重新挂载。
// Mac app 的菜单栏小面板（/menubar）是单独一个窗口：没有侧边栏、页签和手机边框
function Shell({ children }: { children: ReactNode }) {
  const wide = useWide()
  const menubar = usePathname() === '/menubar'
  useShortcuts()
  useTauriEvents(menubar)
  // 使用记录：启动和每次回到前台时上报；菜单栏面板不算打开
  useUsageFlush(!menubar)
  useLanguageSync()
  // 菜单栏面板在 Mac app 里是 Popover 毛玻璃窗口：根和页面底色都透明（面板自己叠 popoverTint）
  if (menubar) return <View style={[styles.page, tauri !== null && styles.clear]}>{children}</View>
  return (
    <View style={[styles.page, wide && styles.row, wide && tauri !== null && styles.clear]}>
      {wide ? <Sidebar /> : null}
      <View style={wide ? styles.main : styles.phone}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row' },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.bg },
  // Mac app：根背景透明，侧边栏透出毛玻璃；红黄绿嵌在 52 高的顶栏那一行（顶栏和侧栏顶部是拖动区）
  clear: { backgroundColor: 'transparent' },
  phone:
    Platform.OS === 'web'
      ? {
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: colors.line,
          overflow: 'hidden',
        }
      : { flex: 1 },
})
