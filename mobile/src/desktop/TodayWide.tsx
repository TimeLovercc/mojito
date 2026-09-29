import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { actions } from '../api/client'
import type { CalEvent, Draft, Feedback, FocusItem, HubRecord, Item, ItemsList, Plan, PlansList, Project, Today } from '../api/types'
import { blockingReview, useAct } from '../components/Decision'
import { StaleBanner } from '../components/Screen'
import { useDeleteEvent } from '../components/useDeleteEvent'
import { category, sourceName } from '../labels'
import { clock, daysBetween, greeting, longDate, shortDate, todayYmd, weekdayOf, ymdOf } from '../time'
import { t, tc } from '../i18n'
import { useErrorToast, useToast } from '../toast'
import { colors, font, size } from '../theme'
import { trackAction, useViewTracking } from '../usage'
import { useHub } from '../use-hub'
import { hoverRow } from '../web-data'
import { TopBarD, useScrolled } from './TopBar'
import { dt } from './tokens'
import { BtnD, Pill, Section } from './ui'

// 电脑今天页（docs/desktop-v2.md 逐页方案 1、内部界面稿（未公开） 第 1 节，用户拍板"被忘了"在右栏）：
// 宋体问候 + 计划第几天；左栏 今日重点 → 逾期 → 等你拍板，右栏 今天日程 → 夜里 → 被忘了；
// 左栏各卡共用 56 宽首列（时间 / 类型 / 研究·生活）；空块整块不显示，今日重点全空时只留一句
export function TodayWide() {
  const view = useHub<Today>('/today')
  useViewTracking('today')
  const [scrolled, onScroll] = useScrolled()
  // 内容区窄于 860 时改单栏
  const [width, setWidth] = useState(0)
  const today = todayYmd()
  return (
    <View style={styles.page}>
      <TopBarD title={t('今天')} sub={`${weekdayOf(today)} ${longDate(today)}`} back={null} tools={null} column={null} scrolled={scrolled} />
      <ScrollView contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={100}>
        <View style={styles.body} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <StaleBanner view={view} />
          {view.data === null ? null : <Board today={view.data} twoCols={width === 0 || width >= 860} />}
        </View>
      </ScrollView>
    </View>
  )
}

function Board({ today, twoCols }: { today: Today; twoCols: boolean }) {
  const n = today.needs_you
  const needCount = n.items.length + n.plans.length + n.drafts.length + n.projects.length + n.feedback.length
  const left = (
    <>
      {today.focus.length === 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('今日重点')}</Text>
          <Text style={styles.none}>{t('今天没有到期的事')}</Text>
        </View>
      ) : (
        <Section title={t('今日重点')} right={null} empty={false}>
          {today.focus.map((i) => (
            <FocusRowD key={i.id} item={i} />
          ))}
        </Section>
      )}
      <Section title={t('逾期')} right={null} empty={today.overdue.length === 0}>
        {today.overdue.map((i) => (
          <LineRow key={i.id} item={i} pill={<Pill label={overdueDays(i) === 1 ? t('逾期 1 天') : t('逾期 {n} 天', { n: overdueDays(i) })} tone="warn" />} />
        ))}
      </Section>
      <Section title={t('等你拍板')} right={null} empty={needCount === 0}>
        {n.plans.map((p) => (
          <PlanAsk key={p.id} plan={p} />
        ))}
        {n.items.map((i) => (
          <ItemAsk key={i.id} item={i} />
        ))}
        {n.drafts.map((d) => (
          <DraftAsk key={d.id} draft={d} />
        ))}
        {n.projects.map((p) => (
          <ProjectAsk key={p.id} project={p} />
        ))}
        {n.feedback.map((fb) => (
          <FeedbackAsk key={fb.id} fb={fb} />
        ))}
      </Section>
    </>
  )
  const right = (
    <>
      <Section title={t('今天日程')} right={null} empty={today.schedule.length === 0}>
        {[...today.schedule]
          .sort((a, b) => Number(b.all_day) - Number(a.all_day))
          .map((e) => (
            <EventRowD key={e.uid + e.start} event={e} />
          ))}
      </Section>
      <Section title={t('夜里')} right={null} empty={today.alerts.length === 0}>
        {today.alerts.map((r) => (
          <NightRow key={r.id} record={r} />
        ))}
      </Section>
      <Section title={t('被忘了')} right={null} empty={today.forgotten.length === 0}>
        {today.forgotten.map((i) => (
          <LineRow key={i.id} item={i} pill={<Pill label={forgottenFact(i)} tone="bad" />} />
        ))}
      </Section>
    </>
  )
  return (
    <View style={styles.today}>
      <View style={styles.hello}>
        <Text style={styles.display}>{greeting()}</Text>
        <PeriodLine plan={today.plan} />
      </View>
      {twoCols ? (
        <View style={styles.cols}>
          <View style={styles.left}>{left}</View>
          <View style={styles.right}>{right}</View>
        </View>
      ) : (
        <View style={styles.col}>
          {left}
          {right}
        </View>
      )}
    </View>
  )
}

// 计划第几天 · 离结束还有几天（数字中性色）
function PeriodLine({ plan }: { plan: Plan | null }) {
  const today = todayYmd()
  if (plan === null) return <Text style={styles.period}>{t('现在没有进行中的两周计划')}</Text>
  const day = daysBetween(plan.start, today) + 1
  const left = daysBetween(today, plan.end)
  if (day < 1)
    return (
      <Text style={styles.period}>
        {t('两周计划 {date} 开始，还有 ', { date: shortDate(plan.start) })}
        {dayCount(1 - day)}
      </Text>
    )
  if (left < 0) return <Text style={styles.period}>{t('本期计划已于 {date} 结束', { date: shortDate(plan.end) })}</Text>
  return (
    <Text style={styles.period}>
      {t('两周计划第 {day} 天 · 离结束还有 ', { day })}
      {dayCount(left)}
    </Text>
  )
}

// 逾期几天（按本地日期）；被忘了写事实：没排时间，或多少天没更新
const overdueDays = (i: Item) => (i.next_at === null ? 0 : daysBetween(ymdOf(new Date(i.next_at)), todayYmd()))
const forgottenFact = (i: Item) => {
  if (i.next_at === null) return t('没排时间')
  const n = daysBetween(ymdOf(new Date(i.updated_at)), todayYmd())
  return n === 1 ? t('1 天没更新') : t('{n} 天没更新', { n })
}
const dayCount = (n: number) => (n === 1 ? t('1 天') : t('{n} 天', { n }))

// 今日重点一行（最小 60）：56 首列时间（今天写时刻，以后写日期）；标题 16/500 最多两行；"下一步："+ 步骤 15/500 brand；
// 以后到期的右边一个中性"还有 N 天"；没有勾选框，整行点进事项
function FocusRowD({ item }: { item: FocusItem }) {
  const router = useRouter()
  if (item.next_at === null) throw new Error(`今日重点里的事项 ${item.id} 没有 next_at`)
  const later = item.days_until > 0
  return (
    <Pressable style={styles.focus} onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })} {...hoverRow}>
      <Text style={[styles.focusTime, later && { color: colors.tx2 }]}>
        {later ? shortDate(ymdOf(new Date(item.next_at))) : clock(item.next_at)}
      </Text>
      <View style={styles.mid}>
        <Text style={styles.focusTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.next} numberOfLines={2}>
          <Text style={styles.nextKey}>{t('下一步：')}</Text>
          <Text style={styles.nextStep}>{item.next_step}</Text>
        </Text>
      </View>
      {later ? (
        <View style={styles.focusPill}>
          <Pill label={item.days_until === 1 ? t('还有 1 天') : t('还有 {n} 天', { n: item.days_until })} tone="neutral" />
        </View>
      ) : null}
    </Pressable>
  )
}

// 逾期 / 被忘了一行（44）：56 首列研究/生活 12 tx3；标题 15/500 单行；右边只写事实的胶囊
function LineRow({ item, pill }: { item: Item; pill: ReactNode }) {
  const router = useRouter()
  return (
    <Pressable style={styles.line} onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })} {...hoverRow}>
      <Text style={styles.area}>{category[item.category].label}</Text>
      <Text style={styles.lineTitle} numberOfLines={1}>
        {item.title}
      </Text>
      {pill}
    </Pressable>
  )
}

// 等你拍板一行（最小 52）：56 首列类型 12 tx3；标题 15/500 + 后果常驻一行 12 tx2；右边该类型现有的动作，主操作在最右
function AskRow({
  type,
  title,
  consequence,
  onOpen,
  children,
}: {
  type: string
  title: string
  consequence: string
  onOpen: (() => void) | null
  children: ReactNode
}) {
  const inner = (
    <>
      <Text style={styles.type}>{type}</Text>
      <View style={styles.mid}>
        <Text style={styles.askTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.consequence} numberOfLines={1}>
          {consequence}
        </Text>
      </View>
      <View style={styles.btns}>{children}</View>
    </>
  )
  if (onOpen === null) return <View style={styles.ask}>{inner}</View>
  return (
    <Pressable style={styles.ask} onPress={onOpen} {...hoverRow}>
      {inner}
    </Pressable>
  )
}

// 计划 / 修订版：只有"同意"（没有 decline 接口），整行点开看详情；被上期复盘挡住时写"先复盘上期 ›"
function PlanAsk({ plan }: { plan: Plan }) {
  const router = useRouter()
  const { act, busy } = useAct()
  const plans = useHub<PlansList>('/plans')
  const items = useHub<ItemsList>('/items')
  const blocking = plans.data === null ? undefined : blockingReview(plans.data.plans, plan)
  const title = (id: string) => {
    const it = items.data === null ? undefined : items.data.items.find((i) => i.id === id)
    return it === undefined ? id : it.title
  }
  let consequence = t('同意后这期计划开始生效，上一期结束')
  if (plan.revises !== null) {
    const original = plans.data === null ? undefined : plans.data.plans.find((p) => p.id === plan.revises)
    const added = original === undefined ? [] : plan.item_ids.filter((id) => !original.item_ids.includes(id)).map(title)
    const removed = original === undefined ? [] : original.item_ids.filter((id) => !plan.item_ids.includes(id)).map(title)
    const parts = [
      added.length === 0 ? null : t('加：{list}', { list: added.join(t('、')) }),
      removed.length === 0 ? null : t('减：{list}', { list: removed.join(t('、')) }),
    ].filter((x) => x !== null)
    consequence = t('同意后替换当前计划。{change}', { change: parts.length === 0 ? t('事项没变') : parts.join(t('；')) })
  }
  return (
    <AskRow
      type={plan.revises === null ? t('计划') : t('计划修订')}
      title={`${plan.revises === null ? t('新一期计划') : t('本期计划修订版')} ${shortDate(plan.start)} – ${shortDate(plan.end)}`}
      consequence={consequence}
      onOpen={() => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })}
    >
      {blocking !== undefined ? (
        <Text style={styles.blocked} onPress={() => router.push({ pathname: '/plans/[id]', params: { id: blocking.id } })}>
          {t('先复盘上期 ›')}
        </Text>
      ) : (
        <BtnD
          label={t('同意')}
          kind="accept"
          size="sm"
          disabled={busy || plans.data === null}
          onPress={() =>
            act(t('计划已生效'), (hub) => {
              trackAction('decision', { action: 'approve', object: 'plan' })
              return actions.approvePlan(hub, plan.id)
            })
          }
        />
      )}
    </AskRow>
  )
}

// 事项草稿：不要 · 同意
function ItemAsk({ item }: { item: Item }) {
  const router = useRouter()
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action, object: 'item' })
      return actions.decide(hub, item.id, { action })
    })
  return (
    <AskRow
      type={t('事项草稿')}
      title={item.title}
      consequence={
        item.next_at === null
          ? t('同意后变成进行中的事项')
          : t('同意后变成进行中的事项，下次 {when}', { when: `${shortDate(ymdOf(new Date(item.next_at)))} ${clock(item.next_at)}` })
      }
      onOpen={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
    >
      <BtnD label={t('不要')} kind="ghost" size="sm" disabled={busy} onPress={() => decide('decline', t('已关闭'))} />
      <BtnD label={t('同意')} kind="accept" size="sm" disabled={busy} onPress={() => decide('approve', t('已同意'))} />
    </AskRow>
  )
}

// 对外草稿：mojito 不替你发——不要 · 复制正文 · 我已发出
function DraftAsk({ draft }: { draft: Draft }) {
  const { act, busy } = useAct()
  const toast = useToast()
  const showError = useErrorToast()
  const resolve = (status: 'dismissed' | 'sent_by_me') =>
    act(status === 'sent_by_me' ? t('已记为你发出了') : t('草稿已放下'), (hub) => {
      trackAction('draft_resolve', { status, channel: draft.channel })
      return actions.resolveDraft(hub, draft.id, status)
    })
  const copy = () =>
    Clipboard.setStringAsync(draft.body).then(
      () => toast(t('正文已复制，去原渠道发出后回来点"我已发出"'), false),
      (err: Error) => showError(t('没复制上'), err),
    )
  return (
    <AskRow
      type={t('对外草稿')}
      title={draft.subject === null ? t('给 {to}', { to: draft.to }) : t('给 {to}：{subject}', { to: draft.to, subject: draft.subject })}
      consequence={draft.channel === 'email' ? t('mojito 不会替你发送；复制后在邮箱里发出') : t('mojito 不会替你发送；复制后在原渠道发出')}
      onOpen={null}
    >
      <BtnD label={tc('草稿', '不要')} kind="ghost" size="sm" disabled={busy} onPress={() => resolve('dismissed')} />
      <BtnD label={t('复制正文')} kind="neutral" size="sm" disabled={busy} onPress={copy} />
      <BtnD label={t('我已发出')} kind="neutral" size="sm" disabled={busy} onPress={() => resolve('sent_by_me')} />
    </AskRow>
  )
}

// 发现新项目：不要 · 同意
function ProjectAsk({ project }: { project: Project }) {
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action, object: 'project' })
      return actions.decideProject(hub, project.id, action)
    })
  return (
    <AskRow type={t('新项目')} title={project.title} consequence={t('确认后成为你的项目，出现在项目页')} onOpen={null}>
      <BtnD label={t('不要')} kind="ghost" size="sm" disabled={busy} onPress={() => decide('decline', t('已忽略'))} />
      <BtnD label={t('同意')} kind="accept" size="sm" disabled={busy} onPress={() => decide('approve', t('已加入项目'))} />
    </AskRow>
  )
}

// 维护会话改好、等你确认上线的反馈：不要 · 同意，整行点开看讨论
function FeedbackAsk({ fb }: { fb: Feedback }) {
  const router = useRouter()
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action, object: 'feedback' })
      return actions.decideFeedback(hub, fb.id, action)
    })
  return (
    <AskRow
      type={t('反馈')}
      title={fb.summary === null ? fb.body : fb.summary}
      consequence={t('同意后上线这次修改；不要就不改')}
      onOpen={() => router.push({ pathname: '/feedback/[id]', params: { id: fb.id } })}
    >
      <BtnD label={t('不要')} kind="ghost" size="sm" disabled={busy} onPress={() => decide('decline', t('不改了'))} />
      <BtnD label={t('同意')} kind="accept" size="sm" disabled={busy} onPress={() => decide('approve', t('已同意上线'))} />
    </AskRow>
  )
}

// 日程一行（44，有地点 56）：96 首列 mono 时间段（全天写"全天"并置顶）；标题 15 最多两行；地点 12 tx3；
// 已结束整行 tx3；点开原地展开"删除"（design.md 8.5）
function EventRowD({ event: e }: { event: CalEvent }) {
  const [open, setOpen] = useState(false)
  const { deleting, remove } = useDeleteEvent(e)
  const ended = !e.all_day && Date.parse(e.end) < Date.now()
  const dim = ended || deleting ? { color: colors.tx3 } : null
  return (
    <Pressable style={styles.ev} onPress={() => setOpen(!open)} {...hoverRow}>
      <Text style={[e.all_day ? styles.evAllDay : styles.evTime, dim]}>{e.all_day ? t('全天') : `${clock(e.start)}–${clock(e.end)}`}</Text>
      <View style={styles.mid}>
        <Text style={[styles.evTitle, dim]} numberOfLines={2}>
          {e.title}
        </Text>
        {e.location === null || e.location === '' ? null : <Text style={styles.evLoc}>{e.location}</Text>}
        {open ? (
          <View style={styles.evActs}>
            {deleting ? (
              <Text style={styles.evLoc}>{t('删除中…')}</Text>
            ) : (
              <BtnD label={t('删除')} kind="ghost" size="sm" disabled={false} onPress={remove} />
            )}
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

// 夜里一行（44）：48 首列 mono 12 时间；标题 15 单行；右边 12 tx3 来源中文名
function NightRow({ record: r }: { record: HubRecord }) {
  const router = useRouter()
  return (
    <Pressable
      style={styles.night}
      onPress={() => (r.item_id === null ? router.push('/feed') : router.push({ pathname: '/items/[id]', params: { id: r.item_id } }))}
      {...hoverRow}
    >
      <Text style={styles.nightTime}>{clock(r.at)}</Text>
      <Text style={styles.nightTitle} numberOfLines={1}>
        {r.title}
      </Text>
      <Text style={styles.src}>{sourceName(r.source)}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: dt.space.pageX, paddingTop: dt.space.pageTop, paddingBottom: 32 },
  body: { width: '100%', maxWidth: dt.width.today },
  today: { gap: 0 },
  hello: { marginBottom: 24 },
  // 问候（拍板 2）：36/44 Songti SC；左移 2px 抵消宋体左侧留白
  display: { fontFamily: '"Songti SC", STSong, serif', fontWeight: '400', fontSize: 36, lineHeight: 44, color: colors.tx, marginLeft: -2 },
  period: { ...font.regular, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2, marginTop: 4 },
  cols: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  left: { flex: 1, minWidth: 440, gap: dt.space.section },
  right: { width: dt.width.todayRight, gap: dt.space.section },
  col: { gap: dt.space.section },
  section: { gap: dt.space.sectionHead },
  sectionTitle: { ...font.medium, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2 },
  none: { ...font.regular, fontSize: size.body, color: colors.tx2 },
  mid: { flex: 1, minWidth: 0 },
  focus: { flexDirection: 'row', alignItems: 'flex-start', minHeight: dt.height.focusRow, paddingVertical: 12, paddingHorizontal: 16 },
  focusTime: { ...font.mono, width: 56, fontSize: size.secondary, lineHeight: 24, color: colors.tx },
  focusTitle: { ...font.medium, fontSize: size.title, lineHeight: 24, color: colors.tx },
  next: { fontSize: size.body, lineHeight: dt.line.body },
  nextKey: { ...font.regular, fontSize: size.secondary, lineHeight: 20, color: colors.tx2 },
  nextStep: { ...font.medium, fontSize: size.body, lineHeight: dt.line.body, color: colors.brand, userSelect: 'text' },
  focusPill: { marginLeft: 12, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, gap: 0 },
  area: { ...font.regular, width: 56, fontSize: size.small, color: colors.tx3 },
  lineTitle: { ...font.medium, flex: 1, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx, marginRight: 12 },
  ask: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 7, paddingHorizontal: 16 },
  type: { ...font.regular, width: 56, fontSize: size.small, color: colors.tx3, alignSelf: 'flex-start', lineHeight: dt.line.body },
  askTitle: { ...font.medium, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx },
  consequence: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx2 },
  btns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 12 },
  blocked: { ...font.medium, fontSize: size.small, color: colors.warn },
  ev: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 44, paddingVertical: 11, paddingHorizontal: 16 },
  evTime: { ...font.mono, width: 96, fontSize: size.secondary, lineHeight: dt.line.body, color: colors.tx2 },
  evAllDay: { ...font.regular, width: 96, fontSize: size.secondary, lineHeight: dt.line.body, color: colors.tx2 },
  evTitle: { ...font.regular, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx },
  evLoc: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  evActs: { flexDirection: 'row', marginTop: 6 },
  night: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16 },
  nightTime: { ...font.mono, width: 48, fontSize: size.small, color: colors.tx2 },
  nightTitle: { ...font.regular, flex: 1, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx },
  src: { ...font.regular, fontSize: size.small, color: colors.tx3, marginLeft: 12 },
})
