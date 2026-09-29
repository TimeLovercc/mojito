import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { GoalsList, ProjectDetail, Snapshot } from '../../src/api/types'
import { ProjectDecision } from '../../src/components/Decision'
import { ItemRow } from '../../src/components/ItemRow'
import { RecordLine } from '../../src/components/RecordLine'
import { Evidence, RichText } from '../../src/components/RichText'
import { Screen } from '../../src/components/Screen'
import { Card, Dot, Empty, Rows, Section, Tag } from '../../src/components/ui'
import { category, projectStatus } from '../../src/labels'
import { ago, when } from '../../src/time'
import { colors, desktop, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useScreenIds, useViewTracking } from '../../src/usage'
import { useChatSubject } from '../../src/wide'
import { t } from '../../src/i18n'

// 项目详情：现状、事项、Orca 快照（worktree 和最近提交）、最近记录
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ProjectPane id={id} head={{ kind: 'back', label: t('项目') }} />
}

// 单独一页（窄屏）或项目页右边的详情栏（宽屏并排，head 为 none）
export function ProjectPane({ id, head }: { id: string; head: { kind: 'back'; label: string } | { kind: 'none' } }) {
  const view = useHub<ProjectDetail>(`/projects/${encodeURIComponent(id)}`)
  const goals = useHub<GoalsList>('/goals')
  useViewTracking('project_detail')
  useScreenIds(null, id)
  useChatSubject(view.data === null ? null : { kind: 'project', id, title: view.data.project.title })
  return (
    <Screen view={view} head={head}>
      {({ project: p, items, snapshot, records }) => (
        <>
          <View style={styles.dh}>
            <Text style={styles.h2}>{p.title}</Text>
            <View style={styles.chips}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{category[p.area].label}</Text>
              </View>
              <Tag {...projectStatus[p.status]} />
              {p.stale ? <Tag label={t('7 天没动静')} tone="r" /> : null}
            </View>
            {p.repo_path === null ? null : <Text style={styles.repo}>{p.repo_path}</Text>}
          </View>

          <Card style={styles.summary}>
            {p.summary === null ? (
              <Text style={styles.summaryText}>{t('还没有现状总结，刷新时 worker 会写一句。')}</Text>
            ) : (
              <RichText text={p.summary} style={styles.summaryText} enums={false} />
            )}
            {p.summary_at === null ? null : (
              <Text style={styles.meta}>
                {when(p.summary_at)}
                {p.summary_evidence === null ? null : (
                  <>
                    {` · ${t('依据：')}`}
                    <Evidence evidence={p.summary_evidence} style={styles.meta} />
                  </>
                )}
              </Text>
            )}
            <Text style={styles.meta}>
              {t('{n} 件进行中', { n: p.open_items })} ·{' '}
              {p.last_activity_at === null ? t('还没有动静') : t('最近动静 {ago}', { ago: ago(p.last_activity_at) })}
            </Text>
          </Card>
          <ProjectDecision project={p} />

          <Section title={t('事项')} right={String(items.length)}>
            {items.length === 0 ? (
              <Empty text={t('这个项目下还没有事项')} />
            ) : (
              <Card style={{ paddingVertical: 4 }}>
                <Rows>
                  {items.map((i) => (
                    <ItemRow key={i.id} item={i} goals={goals.data === null ? null : goals.data.goals} showStatus />
                  ))}
                </Rows>
              </Card>
            )}
          </Section>

          {snapshot === null ? null : <SnapshotView snapshot={snapshot} />}

          <Section title={t('最近记录')} right={String(records.length)}>
            {records.length === 0 ? <Empty text={t('还没有记录')} /> : null}
            <View>
              {records.map((r) => (
                <RecordLine key={r.id} record={r} linkItem showDate={when} />
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  )
}

// Orca 只读快照：各 worktree 状态和终端最后一句、最近 7 天提交
function SnapshotView({ snapshot }: { snapshot: Snapshot }) {
  return (
    <>
      <Section title="Orca" right={t('快照 {ago}', { ago: ago(snapshot.taken_at) })}>
        {snapshot.worktrees.length === 0 ? (
          <Empty text={t('没有 worktree')} />
        ) : (
          <Card>
            <Rows>
              {snapshot.worktrees.map((w) => (
                <View key={w.path} style={styles.wt}>
                  <View style={styles.wtTop}>
                    <Text style={styles.wtName} numberOfLines={1}>
                      {w.name} <Text style={styles.branch}>· {w.branch}</Text>
                    </Text>
                    <Text style={styles.wtStatus}>{w.status}</Text>
                  </View>
                  {w.last_output === '' ? null : (
                    <Text style={styles.wtOut} numberOfLines={2}>
                      {w.last_output}
                    </Text>
                  )}
                  {w.last_activity_at === null ? null : <Text style={styles.meta}>{ago(w.last_activity_at)}</Text>}
                </View>
              ))}
            </Rows>
          </Card>
        )}
      </Section>
      {snapshot.commits.length === 0 ? null : (
        <Section title={t('最近提交')} right={String(snapshot.commits.length)}>
          <Card>
            <Rows>
              {snapshot.commits.map((c) => (
                <View key={c.repo + c.sha} style={styles.commit}>
                  <Text style={styles.commitSubject} numberOfLines={2}>
                    {c.subject}
                  </Text>
                  <Text style={styles.meta}>
                    {c.repo} · {c.sha.slice(0, 7)} · {when(c.at)}
                  </Text>
                </View>
              ))}
            </Rows>
          </Card>
        </Section>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  dh: { gap: 6 },
  h2: { ...font.bold, fontSize: size.page, color: colors.tx, letterSpacing: desktop ? 0 : -0.4, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.raised,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  repo: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  summary: { paddingVertical: 11, paddingHorizontal: 13, gap: 5 },
  summaryText: { ...font.regular, fontSize: size.body, color: colors.tx },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  wt: { paddingVertical: 9, paddingHorizontal: 13, gap: 3 },
  wtTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  wtName: { ...font.medium, fontSize: size.body, color: colors.tx, flexShrink: 1 },
  branch: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  wtStatus: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  wtOut: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  commit: { paddingVertical: 8, paddingHorizontal: 13, gap: 2 },
  commitSubject: { ...font.regular, fontSize: size.secondary, color: colors.tx },
})
