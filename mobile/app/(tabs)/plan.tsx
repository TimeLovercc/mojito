import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { HubError } from '../../src/api/client'
import type { Plan, PlanDetail, PlansList } from '../../src/api/types'
import { Patterns } from '../../src/components/Review'
import { PlanBody, periodName, periodNumber } from '../../src/components/PlanBody'
import { Screen, StaleBanner } from '../../src/components/Screen'
import { Card, Empty, Rows, Section, Seg, Tag } from '../../src/components/ui'
import { planStatus } from '../../src/labels'
import { shortDate, todayYmd } from '../../src/time'
import { colors, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

type Tab = 'current' | 'history'

export default function PlanScreen() {
  const [tab, setTab] = useState<Tab>('current')
  useViewTracking(tab === 'current' ? 'plan_current' : 'plan_history')
  const plans = useHub<PlansList>('/plans')
  const current = useHub<PlanDetail>('/plans/current')
  const router = useRouter()
  const noActive = current.error instanceof HubError && current.error.status === 404
  const seg = (
    <Seg<Tab>
      options={[
        ['current', t('当前')],
        ['history', t('历史')],
      ]}
      value={tab}
      onChange={setTab}
    />
  )
  return (
    <Screen view={plans} head={{ kind: 'title', title: t('计划') }} top={seg} fab>
      {({ plans: list }) =>
        tab === 'current' ? (
          <>
            {noActive ? <Empty text={t('现在没有进行中的计划')} /> : <StaleBanner view={current} />}
            {current.data === null ? null : <PlanBody detail={current.data} number={periodNumber(list, current.data.plan.id)} />}
          </>
        ) : (
          <>
            <LatestPatterns plans={list} />
            <Section title={t('往期')} right={String(list.length)}>
              {list.length === 0 ? (
                <Empty text={t('还没有计划')} />
              ) : (
                <Card>
                  <Rows>
                    {list.map((p) => (
                      <HistoryRow
                        key={p.id}
                        plan={p}
                        name={periodName(periodNumber(list, p.id))}
                        onPress={() => router.push({ pathname: '/plans/[id]', params: { id: p.id } })}
                      />
                    ))}
                  </Rows>
                </Card>
              )}
            </Section>
          </>
        )
      }
    </Screen>
  )
}

// 顶部跨期规律：取最近一期有复盘的计划里的 patterns
function LatestPatterns({ plans }: { plans: Plan[] }) {
  const latest = plans.find((p) => p.review_status !== 'none')
  if (latest === undefined) return null
  return <LatestPatternsOf planId={latest.id} />
}

function LatestPatternsOf({ planId }: { planId: string }) {
  const view = useHub<PlanDetail>(`/plans/${encodeURIComponent(planId)}`)
  if (view.data === null || view.data.review === null || view.data.review.patterns.length === 0) return null
  return (
    <Card style={styles.insightCard}>
      <Patterns patterns={view.data.review.patterns} />
    </Card>
  )
}

// 往期一行：第几期、日期、状态；有复盘的显示完成数和当时写的话
function HistoryRow({ plan, name, onPress }: { plan: Plan; name: string; onPress: () => void }) {
  return (
    <Pressable style={styles.hrow} onPress={onPress}>
      <View style={styles.hmain}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.range}>
          {shortDate(plan.start)} – {shortDate(plan.end)} · {t(plan.item_ids.length === 1 ? '1 件事项' : '{n} 件事项', { n: plan.item_ids.length })}
        </Text>
        {plan.review_status === 'none' ? null : <ReviewLine planId={plan.id} />}
      </View>
      {/* "待复盘"只对已结束的期显示（docs/desktop-v2.md #17） */}
      {plan.review_status === 'draft' && plan.end < todayYmd() ? <Tag label={t('待复盘')} tone="a" /> : <Tag {...planStatus[plan.status]} />}
    </Pressable>
  )
}

function ReviewLine({ planId }: { planId: string }) {
  const view = useHub<PlanDetail>(`/plans/${encodeURIComponent(planId)}`)
  if (view.data === null || view.data.review === null) return null
  const r = view.data.review
  return (
    <>
      <Text style={styles.reviewCount}>
        {t('完成 {done} / {total}', { done: r.completed_item_ids.length, total: r.completed_item_ids.length + r.missed_item_ids.length })}
      </Text>
      {r.user_note === null || r.user_note === '' ? null : (
        <Text style={styles.reviewNote} numberOfLines={2}>
          “{r.user_note}”
        </Text>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  insightCard: { paddingVertical: 10, paddingHorizontal: 13 },
  hmain: { flex: 1, gap: 1 },
  reviewCount: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 3 },
  reviewNote: { ...font.regular, fontSize: size.secondary, color: colors.tx2, marginTop: 2 },
  hrow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  name: { ...font.regular, fontSize: size.body, color: colors.tx },
  range: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 1 },
})
