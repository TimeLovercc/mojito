import { useEffect, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { actions } from '../src/api/client'
import type { AuthList, FocusItem, Item, Plan, PlansList, Project, SourcesList, Today } from '../src/api/types'
import { blockingReview, useAct } from '../src/components/Decision'
import { StaleBanner } from '../src/components/Screen'
import { useConfig } from '../src/config/context'
import { BtnD, Pill } from '../src/desktop/ui'
import { t as tr } from '../src/i18n'
import { problemsOf } from '../src/problems'
import { clock, shortDate, todayYmd, weekdayOf, ymdOf } from '../src/time'
import { colors, font, overlay, popoverTint, size } from '../src/theme'
import { tauri } from '../src/tauri'
import { useErrorToast } from '../src/toast'
import { trackAction } from '../src/usage'
import { useHub } from '../src/use-hub'
import { hoverRow } from '../src/web-data'
export { PageError as ErrorBoundary } from '../src/components/PageError'

// Mac 菜单栏小面板（docs/desktop-v2.md 逐页方案 8、内部界面稿（未公开） 第 4 节；desktop 开 380 宽的 Popover 窗口加载 /menubar）：
// 头部"今天 周一 9/28"+ 更新时间；主块是下一件事（focus[0]），其余今日重点每行 32；等你拍板有才显示，主操作在右；
// 页脚"打开 Mojito"+ 三态点。"打开"都交给 desktop 的 open_main：把主窗口调到前面并跳到那一页
export default function MenubarScreen() {
  const view = useHub<Today>('/today')
  const sources = useHub<SourcesList>('/sources')
  const auth = useHub<AuthList>('/auth-status')
  const { config } = useConfig()
  const open = useOpenMain()
  const problems = problemsOf(config.hub !== null, sources.error !== null, sources.data, auth.data)
  const status =
    problems === null
      ? tr('检查中…')
      : problems.length === 0
        ? tr('一切正常')
        : problems.length === 1
          ? tr('有 1 个问题')
          : tr('有 {n} 个问题', { n: problems.length })
  const tone = problems === null ? colors.tx3 : problems.length === 0 ? colors.ok : problems.some((p) => p.bad) ? colors.bad : colors.warn
  const today = view.data
  const ymd = todayYmd()
  useNoStuckHover()
  // 全部内容（头部到页脚）在 #menubar-content 里，按内容自然高度排；desktop 量它的高度把面板窗口设成一样高
  // （最高 560，超出在这里滚动），所以这一层不能撑满
  return (
    <ScrollView style={styles.page}>
      <View nativeID="menubar-content">
        <View style={styles.head}>
          <Text style={styles.headTitle}>
            {tr('今天')}
            <Text style={styles.headDate}>
              {' '}
              {weekdayOf(ymd)} {shortDate(ymd)}
            </Text>
          </Text>
          {view.fetchedAt === null ? null : (
            <Text style={styles.headMeta}>{tr('{time} 更新', { time: clock(view.fetchedAt) })}</Text>
          )}
        </View>
        <StaleBanner view={view} />
        {today === null ? null : (
          <>
            {today.focus.length === 0 ? (
              <Text style={styles.none}>{tr('今天没有到期的事')}</Text>
            ) : (
              <>
                <NextUp item={today.focus[0]} onOpen={() => open(`/items/${today.focus[0].id}`)} />
                {today.focus.slice(1).map((i) => (
                  <Line key={i.id} title={i.title} onOpen={() => open(`/items/${i.id}`)}>
                    <Text style={styles.time}>{i.days_until === 0 && i.next_at !== null ? clock(i.next_at) : dateOf(i)}</Text>
                  </Line>
                ))}
              </>
            )}
            <NeedsYou today={today} open={open} />
          </>
        )}
        <Pressable style={styles.foot} onPress={() => open('/')}>
          <Text style={styles.footText}>{tr('打开 Mojito')}</Text>
          <Pressable style={styles.status} onPress={() => open('/system')}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={styles.statusText}>{status}</Text>
          </Pressable>
        </Pressable>
      </View>
    </ScrollView>
  )
}

// 面板在鼠标停在某行上时被收起（点了行、点了别处），WebKit 会把这行的 :hover 一直留到下次鼠标移动，
// 再打开时那行像被选中一样灰着。窗口失焦、隐藏或鼠标离开页面时关掉悬停底色，鼠标一动再恢复
function useNoStuckHover() {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const root = document.documentElement
    const off = () => root.setAttribute('data-nohover', '')
    const on = () => root.removeAttribute('data-nohover')
    const onVisibility = () => (document.visibilityState === 'hidden' ? off() : undefined)
    window.addEventListener('blur', off)
    document.addEventListener('mouseleave', off)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('mousemove', on)
    return () => {
      window.removeEventListener('blur', off)
      document.removeEventListener('mouseleave', off)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousemove', on)
    }
  }, [])
}

const dateOf = (i: Item) => (i.next_at === null ? '' : shortDate(ymdOf(new Date(i.next_at))))

// 下一件事：标题 15/500 + 中性时间胶囊（和托盘标题同一写法：今天写时刻，以后写"还有 N 天"）；"下一步：" 12 tx2 + 步骤 13 brand
function NextUp({ item, onOpen }: { item: FocusItem; onOpen: () => void }) {
  if (item.next_at === null) throw new Error(`今日重点里的事项 ${item.id} 没有 next_at`)
  return (
    <Pressable style={styles.main} onPress={onOpen} {...hoverRow}>
      <View style={styles.mainHead}>
        <Text style={styles.mainTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Pill label={item.days_until === 0 ? clock(item.next_at) : item.days_until === 1 ? tr('还有 1 天') : tr('还有 {n} 天', { n: item.days_until })} tone="neutral" />
      </View>
      <Text style={styles.next} numberOfLines={2}>
        <Text style={styles.nextKey}>{tr('下一步：')}</Text>
        <Text style={styles.nextStep}>{item.next_step}</Text>
      </Text>
    </Pressable>
  )
}

// 32 高的一行：标题 13 单行，右边时间或按钮；整行点开主窗口
function Line({ title, onOpen, children }: { title: string; onOpen: () => void; children: ReactNode }) {
  return (
    <Pressable style={styles.row} onPress={onOpen} {...hoverRow}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </Pressable>
  )
}

// 等你拍板（有才显示）：计划和事项草稿、新项目右侧小按钮（主操作在右）；对外草稿、反馈等整行点开主窗口
function NeedsYou({ today, open }: { today: Today; open: (path: string) => void }) {
  const n = today.needs_you
  const count = n.items.length + n.plans.length + n.drafts.length + n.projects.length + n.feedback.length
  if (count === 0) return null
  return (
    <>
      <Text style={styles.label}>{tr('等你拍板')}</Text>
      {n.plans.map((p) => (
        <PlanLine key={p.id} plan={p} open={open} />
      ))}
      {n.items.map((i) => (
        <ItemLine key={i.id} item={i} open={open} />
      ))}
      {n.projects.map((p) => (
        <ProjectLine key={p.id} project={p} open={open} />
      ))}
      {n.drafts.map((d) => (
        <Line key={d.id} title={d.subject === null ? tr('给 {to}', { to: d.to }) : tr('给 {to}：{subject}', { to: d.to, subject: d.subject })} onOpen={() => open('/')}>
          <Text style={styles.chev}>›</Text>
        </Line>
      ))}
      {n.feedback.map((fb) => (
        <Line key={fb.id} title={fb.summary === null ? fb.body : fb.summary} onOpen={() => open(`/feedback/${fb.id}`)}>
          <Text style={styles.chev}>›</Text>
        </Line>
      ))}
    </>
  )
}

function PlanLine({ plan, open }: { plan: Plan; open: (path: string) => void }) {
  const { act, busy } = useAct()
  const plans = useHub<PlansList>('/plans')
  const blocking = plans.data === null ? undefined : blockingReview(plans.data.plans, plan)
  const title = `${plan.revises === null ? tr('新一期计划') : tr('本期计划修订版')} ${shortDate(plan.start)} – ${shortDate(plan.end)}`
  return (
    <Line title={title} onOpen={() => open(`/plans/${plan.id}`)}>
      {blocking !== undefined ? (
        <Text style={styles.blocked} onPress={() => open(`/plans/${blocking.id}`)}>
          {tr('先复盘上期 ›')}
        </Text>
      ) : (
        <BtnD
          label={tr('同意')}
          kind="accept"
          size="xs"
          disabled={busy || plans.data === null}
          onPress={() =>
            act(tr('计划已生效'), (hub) => {
              trackAction('decision', { action: 'approve', object: 'plan' })
              return actions.approvePlan(hub, plan.id)
            })
          }
        />
      )}
    </Line>
  )
}

function ItemLine({ item, open }: { item: Item; open: (path: string) => void }) {
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action, object: 'item' })
      return actions.decide(hub, item.id, { action })
    })
  return (
    <Line title={item.title} onOpen={() => open(`/items/${item.id}`)}>
      <BtnD label={tr('不要')} kind="ghost" size="xs" disabled={busy} onPress={() => decide('decline', tr('已关闭'))} />
      <BtnD label={tr('同意')} kind="accept" size="xs" disabled={busy} onPress={() => decide('approve', tr('已同意'))} />
    </Line>
  )
}

function ProjectLine({ project, open }: { project: Project; open: (path: string) => void }) {
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action, object: 'project' })
      return actions.decideProject(hub, project.id, action)
    })
  return (
    <Line title={tr('发现新项目：{title}', { title: project.title })} onOpen={() => open('/projects')}>
      <BtnD label={tr('不要')} kind="ghost" size="xs" disabled={busy} onPress={() => decide('decline', tr('已忽略'))} />
      <BtnD label={tr('同意')} kind="accept" size="xs" disabled={busy} onPress={() => decide('approve', tr('已加入项目'))} />
    </Line>
  )
}

// Mac app 里调 desktop 的 open_main；普通浏览器（开发）里就在本页跳过去
function useOpenMain(): (path: string) => void {
  const router = useRouter()
  const showError = useErrorToast()
  const t = tauri
  if (t === null) return (path) => router.push(path as Href)
  return (path) => {
    t.core.invoke<null>('open_main', { path }).catch((err: string) => showError(tr('打不开主窗口'), new Error(err)))
  }
}

const styles = StyleSheet.create({
  // Mac app 里窗口是 Popover 毛玻璃，面板叠一层半透明底色；浏览器里用卡片色
  page: { flex: 1, backgroundColor: tauri === null ? colors.card : popoverTint },
  head: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headTitle: { ...font.semibold, fontSize: size.secondary, color: colors.tx },
  headDate: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  headMeta: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  none: {
    ...font.regular,
    fontSize: size.secondary,
    color: colors.tx2,
    marginHorizontal: 6,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  main: { marginHorizontal: 6, marginBottom: 4, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 10, borderRadius: 6 },
  mainHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  mainTitle: { ...font.medium, flex: 1, fontSize: size.body, lineHeight: 22, color: colors.tx },
  next: { marginTop: 2, fontSize: size.secondary, lineHeight: 20 },
  nextKey: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  nextStep: { ...font.regular, fontSize: size.secondary, color: colors.brand },
  row: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 6, paddingHorizontal: 8, borderRadius: 6 },
  rowTitle: { ...font.regular, flex: 1, fontSize: size.secondary, color: colors.tx },
  time: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  chev: { ...font.regular, fontSize: size.secondary, color: colors.tx3 },
  blocked: { ...font.regular, fontSize: size.small, color: colors.warn },
  label: { ...font.medium, fontSize: size.small, color: colors.tx3, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  foot: {
    height: 36,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderTopWidth: 0.5,
    borderTopColor: overlay.hair,
  },
  footText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
