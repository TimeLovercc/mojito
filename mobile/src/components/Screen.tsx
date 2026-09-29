import { useState, type ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Activity, ChevronLeft, CloudOff, MessageCircle, TriangleAlert } from 'lucide-react-native'
import type { SourcesList } from '../api/types'
import { humanize } from '../errors'
import { t } from '../i18n'
import { when } from '../time'
import { Avatar } from './Avatar'
import { BottomInset } from './BottomInset'
import { colors, font, overlay, size, space } from '../theme'
import { useHub, type HubView } from '../use-hub'
import { useWide } from '../wide'
import { dragRegion } from '../web-data'

// none：宽屏并排时右边的详情栏，不要页头
type Head = { kind: 'brand' } | { kind: 'title'; title: string } | { kind: 'back'; label: string } | { kind: 'none' }

// 页面外壳：页头、下拉重取、"数据来自 <时间>"、可选的"对话"浮动按钮。
// footer 不依赖数据，总是显示。
export function Screen<T>({
  view,
  head,
  children,
  top,
  footer,
  fab,
  bottom,
  full,
  flush,
  sub,
}: {
  view: HubView<T>
  head: Head
  children: (data: T) => ReactNode
  top?: ReactNode
  footer?: ReactNode
  fab?: boolean
  // 固定在底部、不随内容滚动（事项详情的"问问这件事"输入框）
  bottom?: ReactNode
  // 宽屏下内容铺满（今天两栏、并排的列表）；不给时限制在适合阅读的宽度
  full?: boolean
  // 宽屏并排的列表栏：内容贴边、行与行之间没有间距（照 内部界面稿（未公开） 的行列表）
  flush?: boolean
  // 宽屏顶栏标题旁的小字（如信息流"6 条新的"）
  sub?: string
}) {
  const insets = useSafeAreaInsets()
  const wide = useWide()
  const syncing = view.syncing && !view.pulling
  // 整页避让键盘（edge-to-edge 下系统不再自动缩小窗口）：底部输入框、系统页设置都不被挡
  return (
    <KeyboardAvoidingView style={styles.page} behavior="padding">
      {wide && head.kind !== 'none' ? <TopBar head={head} sub={sub === undefined ? null : sub} syncing={syncing} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={
          wide
            ? flush
              ? styles.flushContent
              : [styles.content, styles.wideContent, full ? styles.wideFull : styles.read]
            : [styles.content, { paddingTop: insets.top + 6 }]
        }
        refreshControl={<RefreshControl refreshing={view.pulling} onRefresh={view.pull} tintColor={colors.tx2} />}
      >
        {wide ? null : <PageHead head={head} syncing={syncing} />}
        {top}
        <StaleBanner view={view} />
        {/* 只有从来没拿到过数据时才显示加载态 */}
        {view.data === null && view.error === null ? <ActivityIndicator style={styles.loading} color={colors.tx2} /> : null}
        {view.data === null ? null : children(view.data)}
        {footer}
      </ScrollView>
      {fab && !wide ? <ChatFab /> : null}
      {bottom === undefined ? null : <BottomInset>{bottom}</BottomInset>}
    </KeyboardAvoidingView>
  )
}

type BarHead = { kind: 'brand' } | { kind: 'title'; title: string } | { kind: 'back'; label: string }

// 宽屏顶栏（内部界面稿（未公开） 的 .bar）：高 52、下边线；左边标题 + 小字（或"‹ 返回"），右边同步小圆点。对话入口只在侧边栏（用户定）。
// 并排的页面（信息流、项目）自己在两栏上方放一条，列表栏的 Screen 用 head none
export function TopBar({ head, sub, syncing }: { head: BarHead; sub: string | null; syncing: boolean }) {
  const router = useRouter()
  return (
    <View style={styles.bar} {...dragRegion}>
      {head.kind === 'back' ? (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.back} hitSlop={8}>
          <ChevronLeft size={16} color={colors.tx2} />
          <Text style={styles.backText}>{head.label}</Text>
        </Pressable>
      ) : (
        <View style={styles.barTitleRow}>
          <Text style={styles.barTitle}>{head.kind === 'brand' ? t('今天') : head.title}</Text>
          {sub === null ? null : <Text style={styles.barSub}>{sub}</Text>}
        </View>
      )}
      <View style={styles.acts}>
        <SyncDot on={syncing} />
      </View>
    </View>
  )
}

// 窄屏（手机）的页头；宽屏用 TopBar
function PageHead({ head, syncing }: { head: Head; syncing: boolean }) {
  const router = useRouter()
  if (head.kind === 'none') return null
  if (head.kind === 'back') {
    return (
      <View style={styles.backRow}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.back} hitSlop={8}>
          <ChevronLeft size={16} color={colors.tx2} />
          <Text style={styles.backText}>{head.label}</Text>
        </Pressable>
        <SyncDot on={syncing} />
      </View>
    )
  }
  return (
    <View style={styles.top}>
      {head.kind === 'brand' ? (
        <View style={styles.brand}>
          <Avatar size={22} />
          <Text style={styles.brandText}>Mojito</Text>
        </View>
      ) : (
        <Text style={styles.title}>{head.title}</Text>
      )}
      <View style={styles.acts}>
        <SyncDot on={syncing} />
        <ChatButton />
        <SystemButton />
      </View>
    </View>
  )
}

// 后台静默更新时的小提示；位置一直占着，出现和消失都不引起重排
function SyncDot({ on }: { on: boolean }) {
  return <View style={styles.sync}>{on ? <ActivityIndicator size="small" color={colors.tx2} /> : null}</View>
}

function ChatButton() {
  const router = useRouter()
  return (
    <Pressable accessibilityLabel={t('对话')} onPress={() => router.push('/chat')} style={styles.ib} hitSlop={6}>
      <MessageCircle size={18} color={colors.tx2} strokeWidth={1.8} />
    </Pressable>
  )
}

// 右上角心跳图标进"系统"；小圆点：数据源全部正常为绿，有失联为红
function SystemButton() {
  const router = useRouter()
  const sources = useHub<SourcesList>('/sources')
  const list = sources.data === null ? null : sources.data.sources
  const dead = list === null ? null : list.some((s) => !s.alive)
  return (
    <Pressable accessibilityLabel={t('系统')} onPress={() => router.push('/system')} style={styles.ib} hitSlop={6}>
      <Activity size={18} color={colors.tx2} strokeWidth={1.8} />
      {dead === null ? null : <View style={[styles.live, { backgroundColor: dead ? colors.bad : colors.ok }]} />}
    </Pressable>
  )
}

// 右下角常驻"对话"按钮（笔记在"笔记"页签里写）
function ChatFab() {
  const router = useRouter()
  return (
    <Pressable
      accessibilityLabel={t('对话')}
      onPress={() => router.push('/chat')}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.8 }]}
    >
      <MessageCircle size={16} color={colors.onBrand} strokeWidth={2} />
      <Text style={styles.fabText}>{t('对话')}</Text>
    </Pressable>
  )
}

export function StaleBanner<T>({ view }: { view: HubView<T> }) {
  const [open, setOpen] = useState(false)
  if (view.error === null) return null
  const h = humanize(view.error)
  return (
    <Pressable style={styles.banner} onPress={() => setOpen(!open)} disabled={h.detail === h.message}>
      {view.data !== null && view.fetchedAt !== null ? (
        <View style={styles.row}>
          <CloudOff size={13} color={colors.warn} />
          <Text style={styles.stale}>{t('数据来自 {time}', { time: when(view.fetchedAt) })}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <TriangleAlert size={13} color={colors.bad} />
        <Text style={styles.error}>
          {h.message}
          {h.detail === h.message ? '' : open ? '' : t('（点开看细节）')}
        </Text>
      </View>
      {open && h.detail !== h.message ? (
        <Text style={styles.detail} selectable>
          {h.detail}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.gutter, paddingBottom: 150, gap: space.section },
  wideContent: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 48, gap: 20 },
  read: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  wideFull: { width: '100%', maxWidth: 1120, alignSelf: 'center' },
  flushContent: { paddingBottom: 32 },
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: overlay.hair,
  },
  barTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  // 顶栏标题 16/600、副标题 13 tx2（docs/desktop-v2.md 外壳）
  barTitle: { ...font.semibold, fontSize: size.title, color: colors.tx },
  barSub: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { ...font.bold, fontSize: size.title, color: colors.tx },
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  ib: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  live: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  acts: { flexDirection: 'row', alignItems: 'center' },
  sync: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.7 }] },
  backText: { ...font.regular, fontSize: size.body, color: colors.tx2 },
  fabText: { ...font.semibold, fontSize: size.body, color: colors.onBrand },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  loading: { marginTop: 40 },
  banner: { gap: 4, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.warnSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stale: { ...font.regular, color: colors.warn, fontSize: size.secondary },
  detail: { ...font.mono, color: colors.tx2, fontSize: size.small },
  error: { ...font.regular, color: colors.bad, fontSize: size.secondary, flexShrink: 1 },
})
