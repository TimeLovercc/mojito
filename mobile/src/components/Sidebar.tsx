import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter, type Href } from 'expo-router'
import { Activity, Bell, FolderKanban, MessageCircle, Newspaper, NotebookPen, Sun, Target, type LucideIcon } from 'lucide-react-native'
import { problemsOf } from '../../app/system'
import type { AuthList, CardsPage, ProjectsList, SourcesList, Today } from '../api/types'
import { useConfig } from '../config/context'
import { daysBetween, todayYmd } from '../time'
import { t } from '../i18n'
import { colors, font, isDark, overlay, sideFallback, size } from '../theme'
import { tauri } from '../tauri'
import { useHub } from '../use-hub'
import { dragRegion, hoverRow } from '../web-data'
import { useToggleChat } from '../wide'

type Tab = { href: Href; label: string; icon: LucideIcon; prefixes: string[] }

// 五个页签，和底部页签一致；prefixes：推入的详情页算在哪个页签下
const TABS: Tab[] = [
  { href: '/', label: t('今天'), icon: Sun, prefixes: [] },
  { href: '/plan', label: t('计划'), icon: Target, prefixes: ['/plan'] },
  { href: '/projects', label: t('项目'), icon: FolderKanban, prefixes: ['/projects', '/items'] },
  { href: '/cards', label: t('信息流'), icon: Newspaper, prefixes: ['/cards', '/taste', '/subscriptions'] },
  { href: '/notes', label: t('笔记'), icon: NotebookPen, prefixes: ['/notes', '/records'] },
]

// 宽屏左侧边栏（docs/desktop-v2.md 侧栏 220）：顶部 52 留给红黄绿（兼拖动区）；五个页签；空 16；对话 / 系统 / 通知。
// Mac app 里透明透出毛玻璃，浏览器里用回退色；选中是中性叠加 + 品牌色图标
export function Sidebar() {
  const router = useRouter()
  const path = usePathname()
  const toggleChat = useToggleChat()
  const { config } = useConfig()
  const today = useHub<Today>('/today')
  const cards = useHub<CardsPage>('/cards?limit=20')
  const sources = useHub<SourcesList>('/sources')
  const auth = useHub<AuthList>('/auth-status')
  const projects = useHub<ProjectsList>('/projects')

  const needs = today.data === null ? null : Object.values(today.data.needs_you).reduce((n, list) => n + list.length, 0)
  const fresh = cards.data === null ? null : freshCount(cards.data)
  const plan = today.data === null ? null : planDay(today.data.plan)
  const projectCount = projects.data === null ? null : projects.data.projects.length
  // 系统三态点，和系统页、菜单栏同一套判断：正常 ok / 只有需要留意 warn / 有问题 bad
  const problems = problemsOf(config.hub !== null, sources.error !== null, sources.data, auth.data)
  const tone = problems === null ? null : problems.length === 0 ? colors.ok : problems.some((p) => p.bad) ? colors.bad : colors.warn
  const onTab = (t: Tab) => (t.href === '/' ? path === '/' : t.prefixes.some((p) => path.startsWith(p)))
  const count = (text: string) => <Text style={styles.ct}>{text}</Text>

  return (
    <View style={styles.side}>
      {/* 0–52：红黄绿所在，兼窗口拖动区，不放字 */}
      <View style={styles.lights} {...dragRegion} />
      {TABS.map((t) => (
        <Nav
          key={t.label}
          icon={t.icon}
          label={t.label}
          on={onTab(t)}
          onPress={() => router.navigate(t.href)}
          right={
            t.href === '/' && needs !== null && needs > 0 ? (
              <Text style={styles.hot}>{needs}</Text>
            ) : t.href === '/plan' && plan !== null ? (
              count(plan)
            ) : t.href === '/projects' && projectCount !== null ? (
              count(String(projectCount))
            ) : t.href === '/cards' && fresh !== null && fresh !== '0' ? (
              count(fresh)
            ) : t.href === '/notes' ? (
              count('⌘N')
            ) : null
          }
        />
      ))}
      <View style={styles.gap} />
      <Nav icon={MessageCircle} label={t('对话')} on={path === '/chat'} onPress={toggleChat} right={count('⌘J')} />
      <Nav
        icon={Activity}
        label={t('系统')}
        on={path.startsWith('/system') || path.startsWith('/feedback')}
        onPress={() => router.navigate('/system')}
        right={tone === null ? null : <View style={[styles.dot, { backgroundColor: tone }]} />}
      />
      <Nav icon={Bell} label={t('通知')} on={path.startsWith('/notify')} onPress={() => router.navigate('/notify')} right={null} />
    </View>
  )
}

// 计划：进行中的两周计划第几天 / 共几天；没有计划或不在期内不显示
function planDay(plan: Today['plan']): string | null {
  if (plan === null) return null
  const today = todayYmd()
  const day = daysBetween(plan.start, today) + 1
  const total = daysBetween(plan.start, plan.end) + 1
  return day < 1 || day > total ? null : `${day}/${total}`
}

// 信息流"上次读到这里"之上的张数；已取到的一页里找不到已读位置时，整页都是新的，写"20+"
function freshCount(page: CardsPage): string {
  const cut = page.last_read_id === null ? -1 : page.cards.findIndex((c) => c.id === page.last_read_id)
  if (cut !== -1) return String(cut)
  return page.cards.length === 20 ? '20+' : String(page.cards.length)
}

function Nav({
  icon: Icon,
  label,
  on,
  onPress,
  right,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  onPress: () => void
  right: ReactNode
}) {
  return (
    <Pressable onPress={onPress} style={[styles.nav, on && styles.navOn]} {...hoverRow}>
      <View style={styles.icon}>
        <Icon size={18} color={on ? colors.brand : colors.tx2} strokeWidth={1.5} />
      </View>
      <Text style={[styles.navText, on && styles.navTextOn]}>{label}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  side: {
    width: 220,
    backgroundColor: tauri === null ? sideFallback : isDark ? '#0c0c0c' : 'transparent',
    borderRightWidth: 1,
    borderRightColor: overlay.hair,
    paddingHorizontal: 8,
    gap: 2,
  },
  lights: { height: 52 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 8, borderRadius: 8 },
  navOn: { backgroundColor: overlay.selected },
  icon: { width: 20, alignItems: 'center' },
  navText: { ...font.regular, fontSize: size.body, color: colors.tx2 },
  navTextOn: { ...font.medium, color: colors.tx },
  ct: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  hot: {
    ...font.medium,
    fontSize: size.small,
    color: colors.onBrand,
    backgroundColor: colors.brand,
    borderRadius: 9,
    paddingHorizontal: 6,
    lineHeight: 18,
    overflow: 'hidden',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  gap: { height: 16 },
})
