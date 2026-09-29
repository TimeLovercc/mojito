import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import type { CalEvent, FocusItem, GoalsList, Item, Plan, Today } from '../../src/api/types'
import { ItemDecision, PlanApprove, ProjectDecision } from '../../src/components/Decision'
import { DraftCard } from '../../src/components/DraftCard'
import { FeedbackCard } from '../../src/components/FeedbackCard'
import { PlanRevision } from '../../src/components/PlanRevision'
import { ItemRow } from '../../src/components/ItemRow'
import { Screen } from '../../src/components/Screen'
import { Btn, Card, Consequences, Empty, Rows, Section } from '../../src/components/ui'
import { clock, daysBetween, greeting, longDate, shortDate, todayYmd, weekdayOf, ymdOf } from '../../src/time'
import { colors, desktop, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { useWide } from '../../src/wide'
import { useDeleteEvent } from '../../src/components/useDeleteEvent'
import { TodayWide } from '../../src/desktop/TodayWide'
import { hoverRow } from '../../src/web-data'
import { t } from '../../src/i18n'

// 电脑宽屏用 src/desktop/TodayWide.tsx；手机和浏览器窄屏用下面原来的页面
export default function TodayScreen() {
  const wide = useWide()
  return wide && desktop ? <TodayWide /> : <TodayPhone />
}

function TodayPhone() {
  const view = useHub<Today>('/today')
  useViewTracking('today')
  const goals = useHub<GoalsList>('/goals')
  const router = useRouter()
  const goalList = goals.data === null ? null : goals.data.goals
  const wide = useWide()
  return (
    <Screen view={view} head={{ kind: 'brand' }} fab full sub={`${weekdayOf(todayYmd())} ${longDate(todayYmd())}`}>
      {(today) => {
        const focus = (
          <Section title={t('今日重点')} right={t('今天到期 + 下一件')}>
            {today.focus.length === 0 ? (
              <Empty text={t('今天没有到期的事')} />
            ) : (
              <Card style={styles.list}>
                <Rows>
                  {today.focus.map((i) => (
                    <FocusRow key={i.id} item={i} />
                  ))}
                </Rows>
              </Card>
            )}
          </Section>
        )
        const overdue =
          today.overdue.length === 0 ? null : (
            <Section title={t('逾期')} right={String(today.overdue.length)}>
              <Card style={[styles.list, styles.overdue]}>
                <Rows>
                  {today.overdue.map((i) => (
                    <ItemRow key={i.id} item={i} goals={goalList} showStatus={false} />
                  ))}
                </Rows>
              </Card>
            </Section>
          )
        // 空的块整块不显示（design.md 8.5a），只有今日重点全空时留一句
        const schedule =
          today.schedule.length === 0 ? null : (
            <Section title={t('今天日程')} right={desktop ? undefined : 'Google Calendar'}>
              <Card style={styles.list}>
                <Rows>
                  {today.schedule.map((e) => (
                    <EventRow key={e.uid + e.start} event={e} />
                  ))}
                </Rows>
              </Card>
            </Section>
          )
        const needCount =
          today.needs_you.items.length +
          today.needs_you.plans.length +
          today.needs_you.drafts.length +
          today.needs_you.projects.length +
          today.needs_you.feedback.length
        const needs =
          needCount === 0 ? null : (
            <Section title={t('等你拍板')} right={String(needCount)}>
              {today.needs_you.plans.map((p) => (
                <Card key={p.id} style={styles.ask}>
                  <Text style={styles.askTitle}>
                    {p.revises === null ? t('新一期计划草稿') : t('本期计划修订版')} {shortDate(p.start)} – {shortDate(p.end)}
                  </Text>
                  <Text style={styles.askSub}>
                    {t('{items} 件事项 · {goals} 个目标', { items: p.item_ids.length, goals: p.goal_ids.length })}
                  </Text>
                  <PlanRevision plan={p} />
                  <Consequences
                    lines={
                      p.revises === null
                        ? [t('同意后：这期计划开始生效，上一期结束'), t('要改：在对话里说，或点"看一下"')]
                        : [t('同意后：本期计划按修订版调整'), t('不想改：不用管，原计划照旧')]
                    }
                  />
                  <View style={styles.btns}>
                    <PlanApprove plan={p} />
                    <Btn label={t('看一下')} onPress={() => router.push({ pathname: '/plans/[id]', params: { id: p.id } })} />
                  </View>
                </Card>
              ))}
              {today.needs_you.items.map((i) => (
                <AskItem key={i.id} item={i} />
              ))}
              {today.needs_you.drafts.map((d) => (
                <DraftCard key={d.id} draft={d} />
              ))}
              {today.needs_you.feedback.map((fb) => (
                <FeedbackCard key={fb.id} fb={fb} link />
              ))}
              {today.needs_you.projects.map((p) => (
                <Card key={p.id} style={styles.ask}>
                  <Text style={styles.askTitle}>{t('发现新项目：{title}', { title: p.title })}</Text>
                  <Text style={styles.askSub}>{p.repo_path === null ? t('没有对应仓库') : p.repo_path}</Text>
                  <Consequences lines={[t('确认后：它成为你的项目，出现在项目页'), t('不要：以后不再提示这个仓库')]} />
                  <ProjectDecision project={p} />
                </Card>
              ))}
            </Section>
          )
        const forgotten =
          today.forgotten.length === 0 ? null : (
            <Section title={t('被忘了')} right={String(today.forgotten.length)}>
              <Card style={[styles.list, styles.forgotten]}>
                <Rows>
                  {today.forgotten.map((i) => (
                    <ItemRow key={i.id} item={i} goals={goalList} showStatus={false} />
                  ))}
                </Rows>
              </Card>
            </Section>
          )
        const night =
          today.alerts.length === 0 ? null : (
            <Section title={t('夜里')} right={String(today.alerts.length)}>
              <Card style={styles.list}>
                <Rows>
                  {today.alerts.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.nrow}
                      onPress={() =>
                        r.item_id === null ? router.push('/feed') : router.push({ pathname: '/items/[id]', params: { id: r.item_id } })
                      }
                    >
                      <Text style={styles.src} numberOfLines={1}>
                        {r.source}
                      </Text>
                      <Text style={styles.nText}>
                        {r.title} · {clock(r.at)}
                      </Text>
                    </Pressable>
                  ))}
                </Rows>
              </Card>
            </Section>
          )
        // 宽屏两栏（design.md 8.4）：左边要行动的，右边要知道的
        if (wide) {
          return (
            <>
              <Greeting plan={today.plan} />
              <View style={styles.cols}>
                <View style={[styles.col, { flex: 1.25 }]}>
                  {focus}
                  {overdue}
                  {needs}
                  {forgotten}
                </View>
                <View style={[styles.col, { flex: 1 }]}>
                  {schedule}
                  {night}
                </View>
              </View>
            </>
          )
        }
        return (
          <>
            <Greeting plan={today.plan} />
            {focus}
            {overdue}
            {schedule}
            {needs}
            {forgotten}
            {night}
          </>
        )
      }}
    </Screen>
  )
}

// 日程一行，点开原地展开"删除"（design.md 8.5：任何日程都能删，服务器 agent 真的从 Google 日历删掉，
// 时间线留一条可撤销的记录）。删除任务跑完后重取今天页，这一行就消失了
function EventRow({ event: e }: { event: CalEvent }) {
  const [open, setOpen] = useState(false)
  const { deleting, remove } = useDeleteEvent(e)

  return (
    <Pressable style={({ pressed }) => [styles.evWrap, pressed && { backgroundColor: colors.raised }]} onPress={() => setOpen(!open)}>
      <View style={styles.ev}>
        <Text style={styles.evTime}>{e.all_day ? t('全天') : clock(e.start)}</Text>
        {desktop ? null : <View style={styles.evBar} />}
        <View style={{ flex: 1 }}>
          <Text style={[styles.evTitle, deleting && { color: colors.tx3 }]}>{e.title}</Text>
          {e.location === null || e.location === '' ? null : <Text style={styles.evSub}>{e.location}</Text>}
        </View>
      </View>
      {open ? (
        <View style={styles.evActs}>
          <Text style={styles.evSub}>{e.all_day ? t('全天') : `${clock(e.start)} – ${clock(e.end)}`}</Text>
          {deleting ? (
            <Text style={styles.evSub}>{t('删除中…')}</Text>
          ) : (
            <Pressable accessibilityLabel={t('删除日程')} hitSlop={6} onPress={remove}>
              <Text style={styles.evDelete}>{t('删除')}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Pressable>
  )
}

// 宽屏的日期在顶栏里，这里不再写
function Greeting({ plan }: { plan: Plan | null }) {
  const today = todayYmd()
  const wide = useWide()
  return (
    <View style={styles.greet}>
      {wide ? null : (
        <Text style={styles.date}>
          {weekdayOf(today)} {longDate(today)}
        </Text>
      )}
      <Text style={styles.hello}>{greeting()}</Text>
      <PeriodLine plan={plan} today={today} />
    </View>
  )
}

function PeriodLine({ plan, today }: { plan: Plan | null; today: string }) {
  if (plan === null) return <Text style={styles.period}>{t('现在没有进行中的两周计划')}</Text>
  const day = daysBetween(plan.start, today) + 1
  const left = daysBetween(today, plan.end)
  if (day < 1) {
    return (
      <Text style={styles.period}>
        {t('两周计划 {date} 开始，还有 ', { date: shortDate(plan.start) })}
        <Text style={styles.em}>{t(1 - day === 1 ? '1 天' : '{n} 天', { n: 1 - day })}</Text>
      </Text>
    )
  }
  if (left < 0) return <Text style={styles.period}>{t('本期计划已于 {date} 结束', { date: shortDate(plan.end) })}</Text>
  return (
    <Text style={styles.period}>
      {t('两周计划第 {day} 天 · 离结束还有 ', { day })}
      <Text style={styles.em}>{t(left === 1 ? '1 天' : '{n} 天', { n: left })}</Text>
    </Text>
  )
}

// 今日重点一行：标题、下一步（今天能做的一小步）、今天几点或还有几天
function FocusRow({ item }: { item: FocusItem }) {
  const router = useRouter()
  if (item.next_at === null) throw new Error(`今日重点里的事项 ${item.id} 没有 next_at`)
  const at = item.next_at
  const time = item.days_until === 0
      ? t('今天 {time}', { time: clock(at) })
      : t(item.days_until === 1 ? '还有 1 天 · {date}' : '还有 {n} 天 · {date}', { n: item.days_until, date: shortDate(ymdOf(new Date(at))) })
  return (
    <Pressable
      style={({ pressed }) => [styles.focus, pressed && { backgroundColor: colors.raised }]}
      {...hoverRow}
      onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
    >
      <View style={styles.focusTop}>
        <Text style={styles.focusTitle}>{item.title}</Text>
        <Text style={[styles.focusTime, item.days_until === 0 && !desktop && { color: colors.warn }]}>{time}</Text>
      </View>
      <Text style={styles.focusStep}>{t('下一步：{step}', { step: item.next_step })}</Text>
    </Pressable>
  )
}

function AskItem({ item }: { item: Item }) {
  const router = useRouter()
  return (
    <Card style={styles.ask} onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}>
      <Text style={styles.askTitle}>{item.title}</Text>
      <Text style={[styles.askSub, { color: colors.brand }]}>{t('下一步：{step}', { step: item.next_step })}</Text>
      <Text style={styles.askSub}>{t('算完成：{definition}', { definition: item.done_definition })}</Text>
      <Consequences lines={[t('同意后：这件事进入你的事项列表，开始推进'), t('不要：这件事关闭（之后可以重新打开）'), t('想推迟：在对话里说')]} />
      <ItemDecision item={item} />
    </Card>
  )
}

const styles = StyleSheet.create({
  greet: { gap: 2 },
  // 电脑上不用彩色左边、琥珀"今天"、日程竖条（docs/desktop-v2.md 颜色用法：状态色只表示状态，旁边一定有字）
  overdue: desktop ? {} : { borderLeftWidth: 3, borderLeftColor: colors.warn },
  forgotten: desktop ? {} : { borderLeftWidth: 3, borderLeftColor: colors.bad },
  focus: { paddingVertical: desktop ? 14 : 10, paddingHorizontal: desktop ? 16 : 13, gap: 4 },
  focusTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  focusTitle: { ...font.medium, fontSize: size.title, color: colors.tx, flex: 1 },
  focusTime: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  focusStep: { ...font.regular, fontSize: size.secondary, color: colors.brand, ...(desktop ? { userSelect: 'text' as const } : {}) },
  date: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  hello: { ...font.bold, fontSize: size.page, color: colors.tx, letterSpacing: desktop ? 0 : -0.4 },
  period: { ...font.regular, fontSize: size.secondary, color: colors.tx2, marginTop: 2 },
  em: { color: desktop ? colors.tx2 : colors.warn },
  list: { paddingVertical: 4 },
  ask: {
    paddingVertical: desktop ? 14 : 11,
    paddingHorizontal: desktop ? 16 : 13,
    gap: 6,
    borderLeftWidth: desktop ? 0 : 3,
    borderLeftColor: colors.warn,
  },
  askTitle: { ...font.semibold, fontSize: size.body, color: colors.tx },
  askSub: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  btns: { flexDirection: 'row', gap: 7, marginTop: 2 },
  evWrap: { paddingVertical: desktop ? 12 : 8, paddingHorizontal: desktop ? 16 : 13, gap: 6 },
  ev: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  evActs: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 53 },
  evDelete: { ...font.regular, fontSize: size.secondary, color: colors.bad },
  evTime: { ...font.mono, fontSize: size.small, color: colors.tx2, width: 40 },
  evBar: { width: 3, height: 22, borderRadius: 2, backgroundColor: colors.brand },
  evTitle: { ...font.regular, fontSize: size.body, color: colors.tx },
  evSub: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  nrow: {
    flexDirection: 'row',
    gap: desktop ? 12 : 9,
    paddingVertical: desktop ? 11 : 8,
    paddingHorizontal: desktop ? 16 : 13,
    alignItems: 'flex-start',
  },
  src: { ...font.regular, fontSize: size.small, color: colors.tx2, width: 44, paddingTop: 2 },
  cols: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  col: { gap: 20, minWidth: 0 },
  nText: { ...font.regular, fontSize: size.secondary, color: colors.tx, flex: 1 },
})
