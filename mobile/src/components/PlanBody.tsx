import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Goal, Plan, PlanDetail } from '../api/types'
import { category, itemStatus, planStatus } from '../labels'
import { daysBetween, longDate, shortDate, todayYmd, ymdOf } from '../time'
import { colors, font, size } from '../theme'
import { ProgressBar } from './ProgressBar'
import { ReviewCard } from './Review'
import { Card, Dot, Section, Tag } from './ui'
import { t } from '../i18n'

// 第几期：不算草稿；按 (start, end) 合并计数——被修订版替代的原计划和它的修订版是同一期（docs/desktop-v2.md #17）。
// 草稿返回 null
export function periodNumber(plans: Plan[], id: string): number | null {
  const plan = plans.find((p) => p.id === id)
  if (plan === undefined || plan.status === 'draft') return null
  const periods = [...new Set(plans.filter((p) => p.status !== 'draft').map((p) => `${p.start}/${p.end}`))].sort()
  return periods.indexOf(`${plan.start}/${plan.end}`) + 1
}

export function periodName(n: number | null): string {
  return n === null ? t('计划草稿') : t('第 {n} 期', { n })
}

// 目标标题形如 "工作：季度报告"，冒号前是分组
function groupGoals(goals: Goal[]): [string | null, string[]][] {
  const groups = new Map<string | null, string[]>()
  for (const g of goals) {
    const cut = g.title.indexOf('：')
    const org = cut === -1 ? null : g.title.slice(0, cut)
    const name = cut === -1 ? g.title : g.title.slice(cut + 1)
    const list = groups.get(org)
    if (list === undefined) groups.set(org, [name])
    else list.push(name)
  }
  return [...groups.entries()]
}

// 一期计划：近期目标 + 本期事项与进度 + 结束日期。/plans/current 和 /plans/{id} 共用。
export function PlanBody({ detail, number }: { detail: PlanDetail; number: number | null }) {
  const router = useRouter()
  const { plan, goals, items } = detail
  const today = todayYmd()
  const total = daysBetween(plan.start, plan.end) + 1
  const day = daysBetween(plan.start, today) + 1
  const running = plan.status === 'active' && day >= 1 && day <= total
  return (
    <>
      <Section title={t('近期目标')}>
        <View style={styles.goals}>
          {groupGoals(goals).map(([org, names]) => (
            <Card key={org === null ? names.join() : org} style={styles.goal}>
              {org === null ? null : <Text style={styles.org}>{org}</Text>}
              {names.map((n) => (
                <Text key={n} style={styles.goalName}>
                  {n}
                </Text>
              ))}
            </Card>
          ))}
        </View>
      </Section>

      <Card style={styles.period}>
        <View style={styles.ph}>
          <Text style={styles.phName}>{periodName(number)}</Text>
          <Text style={styles.phMeta}>
            {shortDate(plan.start)} – {shortDate(plan.end)}
            {running ? ` · ${t('第 {day} / {total} 天', { day, total })}` : ` · ${planStatus[plan.status].label}`}
          </Text>
        </View>
        {running ? (
          <View style={styles.timebar}>
            <View style={[styles.timefill, { width: `${(day / total) * 100}%` }]} />
          </View>
        ) : null}
        {items.map((i) => (
          <Pressable key={i.id} style={styles.pi} onPress={() => router.push({ pathname: '/items/[id]', params: { id: i.id } })}>
            <View style={styles.piTop}>
              <View style={styles.piTitle}>
                <Text style={styles.piText}>{i.title}</Text>
              </View>
              {i.forgotten ? <Tag label={t('被忘了')} tone="r" /> : <Tag {...itemStatus[i.status]} />}
            </View>
            {i.progress === null ? (
              <Text style={styles.evid}>{t('下一步：{step}', { step: i.next_step })}</Text>
            ) : (
              <ProgressBar progress={i.progress} color={colors.brand} />
            )}
          </Pressable>
        ))}
        {items.length === 0 ? <Text style={styles.evid}>{t('这期没有事项')}</Text> : null}
      </Card>

      {detail.review === null ? null : <ReviewCard review={detail.review} items={items} />}

      <Text style={styles.end}>
        {t('本期 {date} 结束', { date: longDate(plan.end) })}
        {plan.closed_at === null ? '' : t('（已于 {date} 关闭）', { date: longDate(ymdOf(new Date(plan.closed_at))) })}
        {plan.status === 'active' && detail.review === null ? t('，当天晚上复盘；复盘完才开下一期') : ''}
      </Text>
    </>
  )
}

const styles = StyleSheet.create({
  goals: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  goal: { flexGrow: 1, flexBasis: '45%', paddingVertical: 10, paddingHorizontal: 11, gap: 3 },
  org: { ...font.regular, fontSize: size.small, color: colors.tx2, marginBottom: 2 },
  goalName: { ...font.regular, fontSize: size.secondary, color: colors.tx },
  period: { paddingVertical: 12, paddingHorizontal: 13, gap: 10 },
  ph: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  phName: { ...font.semibold, fontSize: size.title, color: colors.tx },
  phMeta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  timebar: { height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: 'hidden' },
  timefill: { height: 4, backgroundColor: colors.tx2 },
  pi: { gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  piTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  piTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  piText: { ...font.medium, fontSize: size.body, color: colors.tx, flexShrink: 1 },
  evid: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  end: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'center' },
})
