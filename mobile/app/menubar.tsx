import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import type { AuthList, SourcesList, Today } from '../src/api/types'
import { FeedbackDecision, ItemDecision, PlanApprove, ProjectDecision } from '../src/components/Decision'
import { StaleBanner } from '../src/components/Screen'
import { Empty, Rows } from '../src/components/ui'
import { useConfig } from '../src/config/context'
import { t as tr } from '../src/i18n'
import { clock, shortDate, when, ymdOf } from '../src/time'
import { colors, font, size } from '../src/theme'
import { tauri } from '../src/tauri'
import { useErrorToast } from '../src/toast'
import { useHub } from '../src/use-hub'
import { problemsOf } from './system'
import type { ReactNode } from 'react'
import { hoverRow } from '../src/web-data'

// Mac 菜单栏小面板（design.md 8.4、内部界面稿（未公开） 第 4 张；desktop 开一个 380×560 的窗口加载 /menubar）：
// 今日重点、等你拍板（能直接拍板），底部"打开 Mojito"和系统状态。
// "打开"都交给 desktop 的 open_main 命令：把主窗口调到前面并跳到那一页
export default function MenubarScreen() {
  const view = useHub<Today>('/today')
  const sources = useHub<SourcesList>('/sources')
  const auth = useHub<AuthList>('/auth-status')
  const { config } = useConfig()
  const open = useOpenMain()
  const problems = problemsOf(config.hub !== null, sources.error !== null, sources.data, auth.data)
  const status = problems === null ? tr('检查中…') : problems.length === 0 ? tr('系统正常') : problems.length === 1 ? tr('有 1 个问题') : tr('有 {n} 个问题', { n: problems.length })
  const tone = problems === null ? colors.tx3 : problems.length === 0 ? colors.ok : problems.some((p) => p.bad) ? colors.bad : colors.warn
  const today = view.data
  return (
    <View style={styles.page}>
      <View style={styles.head}>
        <Text style={styles.headTitle}>{tr('今天')}</Text>
        <Text style={styles.headMeta}>{view.fetchedAt === null ? tr('读取中…') : tr('{time} 更新', { time: when(view.fetchedAt) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <StaleBanner view={view} />
        {today === null ? null : (
          <>
            <Text style={styles.sh}>{tr('今日重点')}</Text>
            {today.focus.length === 0 ? (
              <Empty text={tr('没有排了时间的事')} />
            ) : (
              <Rows>
                {today.focus.map((i) => (
                  <Row key={i.id} onOpen={() => open(`/items/${i.id}`)}>
                    <Text style={styles.title}>{i.title}</Text>
                    <Text style={styles.step}>{i.next_step}</Text>
                    <Text style={[styles.pill, i.days_until === 0 && styles.pillWarn]}>
                      {i.next_at === null
                        ? tr('没有时间')
                        : i.days_until === 0
                          ? tr('今天 {time}', { time: clock(i.next_at) })
                          : tr(i.days_until === 1 ? '还有 1 天 · {date}' : '还有 {n} 天 · {date}', { n: i.days_until, date: shortDate(ymdOf(new Date(i.next_at))) })}
                    </Text>
                  </Row>
                ))}
              </Rows>
            )}
            <NeedsYou today={today} open={open} />
          </>
        )}
      </ScrollView>
      <View style={styles.foot}>
        <Text style={styles.openMain} onPress={() => open('/')}>
          {tr('打开 Mojito')}
        </Text>
        <Text style={[styles.status, { color: tone }]} onPress={() => open('/system')}>
          {status}
        </Text>
      </View>
    </View>
  )
}

function NeedsYou({ today, open }: { today: Today; open: (path: string) => void }) {
  const n = today.needs_you
  const count = n.items.length + n.plans.length + n.drafts.length + n.projects.length + n.feedback.length
  // 空的块整块不显示（design.md 8.5a）
  if (count === 0) return null
  return (
    <>
      <Text style={styles.sh}>{tr('等你拍板')}</Text>
      <Rows>
        {n.items.map((i) => (
          <Row key={i.id} onOpen={() => open(`/items/${i.id}`)}>
            <Text style={styles.title}>{i.title}</Text>
            <ItemDecision item={i} />
          </Row>
        ))}
        {n.plans.map((p) => (
          <Row key={p.id} onOpen={() => open(`/plans/${p.id}`)}>
            <Text style={styles.title}>
              {p.revises === null ? tr('新一期计划草稿') : tr('本期计划修订版')} {shortDate(p.start)} – {shortDate(p.end)}
            </Text>
            <PlanApprove plan={p} />
          </Row>
        ))}
        {n.projects.map((p) => (
          <Row key={p.id} onOpen={() => open('/')}>
            <Text style={styles.title}>{tr('发现新项目：{title}', { title: p.title })}</Text>
            <ProjectDecision project={p} />
          </Row>
        ))}
        {n.feedback.map((fb) => (
          <Row key={fb.id} onOpen={() => open(`/feedback/${fb.id}`)}>
            <Text style={styles.title}>{fb.summary === null ? fb.body : fb.summary}</Text>
            <FeedbackDecision fb={fb} />
          </Row>
        ))}
        {/* 草稿要复制正文去原渠道发，在主窗口里做 */}
        {n.drafts.map((d) => (
          <Row key={d.id} onOpen={() => open('/')}>
            <Text style={styles.title}>{tr('草稿：{subject}', { subject: d.subject === null ? tr('给 {to}', { to: d.to }) : d.subject })}</Text>
          </Row>
        ))}
      </Rows>
    </>
  )
}

// 整行可点（hover 高亮由 desktop-css 给），点了在主窗口打开；行里的拍板按钮各管各的
function Row({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onOpen} {...hoverRow}>
      {children}
    </Pressable>
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
  page: { flex: 1, backgroundColor: colors.card },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  headTitle: { ...font.semibold, fontSize: size.secondary, color: colors.tx },
  headMeta: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  sh: { ...font.medium, fontSize: size.secondary, color: colors.tx2, paddingTop: 8 },
  row: { gap: 4, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8 },
  title: { ...font.medium, fontSize: size.body, color: colors.tx },
  step: { ...font.regular, fontSize: size.secondary, color: colors.brand },
  pill: {
    ...font.medium,
    alignSelf: 'flex-start',
    fontSize: size.small,
    color: colors.tx2,
    backgroundColor: colors.raised,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pillWarn: { color: colors.warn, backgroundColor: colors.warnSoft },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  openMain: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  status: { ...font.regular, fontSize: size.secondary },
})
