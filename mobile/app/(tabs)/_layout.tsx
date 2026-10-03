import { useEffect } from 'react'
import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FolderKanban, Newspaper, NotebookPen, Sun, Target } from 'lucide-react-native'
import { useConfig } from '../../src/config/context'
import { colors, font, size } from '../../src/theme'
import { prefetch } from '../../src/use-hub'
import { useWide } from '../../src/wide'
import { useKeyboardOpen } from '../../src/viewport'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 四个页签和右上角对话、系统打开时要取的路径；和各页面里 useHub 的路径一致
const TAB_PATHS = [
  '/today',
  '/goals',
  '/plans',
  '/plans/current',
  '/projects?area=research',
  '/projects?area=life',
  '/projects',
  '/items',
  '/records?limit=30',
  '/records?kind=note&author=me&limit=30',
  '/sources',
  '/chat?limit=30',
  '/jobs',
  '/cards?limit=20',
]

export default function TabsLayout() {
  const { config } = useConfig()
  const insets = useSafeAreaInsets()
  // 宽屏由左侧边栏切换页签（src/components/Sidebar.tsx），不显示底部页签栏
  const wide = useWide()
  // 网页版（iPhone）键盘弹出时收起页签栏，给输入框让地方；原生端永远是 false
  const keyboard = useKeyboardOpen()
  useEffect(() => {
    prefetch(TAB_PATHS, config.hub)
  }, [config.hub])
  return (
    <Tabs
      tabBar={wide || keyboard ? () => null : undefined}
      screenOptions={{
        headerShown: false,
        // 切走的页签不卸载（滚动位置保留），冻结不在后台重渲染；数据由上面的 prefetch 先取好
        lazy: false,
        freezeOnBlur: true,
        sceneStyle: { backgroundColor: colors.bg },
        // Android edge-to-edge：页签栏整体抬到手势条 / 三键导航栏之上
        tabBarStyle: {
          backgroundColor: colors.tabbar,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 64 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.tx2,
        tabBarLabelStyle: { ...font.regular, fontSize: size.small },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('今天'), tabBarIcon: ({ color }) => <Sun color={color} size={18} strokeWidth={1.8} /> }} />
      <Tabs.Screen
        name="plan"
        options={{ title: t('计划'), tabBarIcon: ({ color }) => <Target color={color} size={18} strokeWidth={1.8} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: t('项目'), tabBarIcon: ({ color }) => <FolderKanban color={color} size={18} strokeWidth={1.8} /> }}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: t('信息流'), tabBarIcon: ({ color }) => <Newspaper color={color} size={18} strokeWidth={1.8} /> }}
      />
      <Tabs.Screen
        name="notes"
        options={{ title: t('笔记'), tabBarIcon: ({ color }) => <NotebookPen color={color} size={18} strokeWidth={1.8} /> }}
      />
    </Tabs>
  )
}
