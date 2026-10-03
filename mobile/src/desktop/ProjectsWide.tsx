import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { actions } from '../api/client'
import type { Item, Project, ProjectDetail, ProjectsList, Snapshot } from '../api/types'
import { projectActions, useAct } from '../components/Decision'
import { RecordLine } from '../components/RecordLine'
import { StaleBanner } from '../components/Screen'
import { t } from '../i18n'
import { category, itemStatus, killState, projectStatus } from '../labels'
import { ago, daysBetween, todayYmd, when, ymdOf } from '../time'
import { colors, font, overlay, size } from '../theme'
import { trackAction, useScreenIds, useViewTracking } from '../usage'
import { useHub } from '../use-hub'
import { hoverRow } from '../web-data'
import { useChatSubject } from '../wide'
import { Menu } from './Menu'
import { TopBarD, useScrolled } from './TopBar'
import { dt } from './tokens'
import { OverviewD, ScoreBadgeD } from './ProjectOverviewD'
import { Pill, pillOf, Section } from './ui'

// 电脑项目页（docs/desktop-v2.md 逐页方案 3）：顶栏"项目 · N 个"，选中项目后右侧"⋯"放暂停 / 完成 / 恢复；
// 左边 260 列表按研究 / 生活分组（每行 36，名称 + 右边生死实验小胶囊），底部"全部事项 ›"；右边详情最宽 720：
// 12 tx3"研究 · 进行中"、名称 24/600（右侧分数徽章）、没动静时中性事实胶囊、概况各块（design.md 8.11，每个项目都显示，取代原来的现状）、
// 事项行、会话、最近记录（默认折叠）。其余空块整块隐藏；不显示仓库路径、"依据"和写死的"7 天没动静"
export function ProjectsWide() {
  const research = useHub<ProjectsList>('/projects?area=research')
  const life = useHub<ProjectsList>('/projects?area=life')
  const router = useRouter()
  const [picked, setPicked] = useState<string | null>(null)
  useViewTracking('projects')
  const all = [...(research.data === null ? [] : research.data.projects), ...(life.data === null ? [] : life.data.projects)]
  const selected = picked !== null && all.some((p) => p.id === picked) ? all.find((p) => p.id === picked) : all[0]
  const loaded = research.data !== null && life.data !== null
  const group = (title: string, list: Project[] | null) =>
    list === null || list.length === 0 ? null : (
      <>
        <Text style={styles.group}>{title}</Text>
        {list.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setPicked(p.id)}
            style={[styles.pi, selected !== undefined && p.id === selected.id && styles.piOn]}
            {...hoverRow}
          >
            <Text style={[styles.piText, selected !== undefined && p.id === selected.id && styles.piTextOn]} numberOfLines={1}>
              {p.title}
            </Text>
            {p.overview === null || p.overview.kill === null ? null : (
              <Pill label={killState[p.overview.kill.state].label} tone={pillOf[killState[p.overview.kill.state].tone]} />
            )}
          </Pressable>
        ))}
      </>
    )
  return (
    <View style={styles.page}>
      <TopBarD
        title={t('项目')}
        sub={loaded ? t('{n} 个', { n: all.length }) : null}
        back={null}
        tools={selected === undefined ? null : <ProjectMenu project={selected} />}
        column={null}
        scrolled={false}
      />
      <View style={styles.split}>
        <ScrollView style={styles.plist} contentContainerStyle={styles.plistBody}>
          <StaleBanner view={research} />
          {group(t('研究'), research.data === null ? null : research.data.projects)}
          {group(t('生活'), life.data === null ? null : life.data.projects)}
          {loaded && all.length === 0 ? <Text style={styles.none}>{t('还没有项目')}</Text> : null}
          <View style={styles.sep} />
          <Pressable onPress={() => router.push('/items')} style={styles.pi} {...hoverRow}>
            <Text style={styles.piText}>{t('全部事项')}</Text>
            <ChevronRight size={15} color={colors.tx3} />
          </Pressable>
        </ScrollView>
        <View style={styles.detail}>{selected === undefined ? null : <ProjectDetailD key={selected.id} id={selected.id} />}</View>
      </View>
    </View>
  )
}

// "⋯"：该状态下现有的动作（暂停 / 完成 / 恢复；新发现的项目是确认 / 不要）
function ProjectMenu({ project }: { project: Project }) {
  const { act } = useAct()
  const list = projectActions[project.status]
  if (list.length === 0) return null
  return (
    <Menu
      label={t('更多')}
      items={list.map((a) => ({
        label: a.label,
        danger: a.danger,
        onPress: () =>
          act(a.done, (hub) => {
            trackAction('decision', { action: a.action, object: 'project' })
            return actions.decideProject(hub, project.id, a.action)
          }),
      }))}
    />
  )
}

function ProjectDetailD({ id }: { id: string }) {
  const view = useHub<ProjectDetail>(`/projects/${encodeURIComponent(id)}`)
  useViewTracking('project_detail')
  useScreenIds(null, id)
  useChatSubject(view.data === null ? null : { kind: 'project', id, title: view.data.project.title })
  const [scrolled, onScroll] = useScrolled()
  return (
    <ScrollView
      style={[styles.detailScroll, scrolled && styles.detailLine]}
      contentContainerStyle={styles.detailBody}
      onScroll={onScroll}
      scrollEventThrottle={100}
    >
      <View style={styles.column}>
        <StaleBanner view={view} />
        {view.data === null ? null : <Body detail={view.data} />}
      </View>
    </ScrollView>
  )
}

const quietDays = (n: number) => (n === 1 ? t('1 天没动静') : t('{n} 天没动静', { n }))

function Body({ detail: { project: p, items, snapshot, records } }: { detail: ProjectDetail }) {
  const [showRecords, setShowRecords] = useState(false)
  const quiet =
    p.last_activity_at === null
      ? t('还没有动静')
      : quietDays(daysBetween(ymdOf(new Date(p.last_activity_at)), todayYmd()))
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.kicker}>
          {category[p.area].label} · {projectStatus[p.status].label}
        </Text>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{p.title}</Text>
          <ScoreBadgeD overview={p.overview} />
        </View>
        {p.stale ? (
          <View style={styles.pillRow}>
            <Pill label={quiet} tone="neutral" />
          </View>
        ) : null}
      </View>
      <OverviewD overview={p.overview} />
      <Section title={t('事项')} right={null} empty={items.length === 0}>
        {items.map((i) => (
          <ItemLine key={i.id} item={i} />
        ))}
      </Section>
      {snapshot === null ? null : <Sessions snapshot={snapshot} />}
      {records.length === 0 ? null : (
        <View style={styles.records}>
          <Pressable style={styles.recordsHead} onPress={() => setShowRecords(!showRecords)} {...hoverRow}>
            <Text style={styles.recordsTitle}>{t('最近记录')}</Text>
            {showRecords ? <ChevronDown size={14} color={colors.tx2} /> : <ChevronRight size={14} color={colors.tx2} />}
          </Pressable>
          {showRecords ? records.map((r) => <RecordLine key={r.id} record={r} linkItem showDate={when} />) : null}
        </View>
      )}
    </>
  )
}

function ItemLine({ item }: { item: Item }) {
  const router = useRouter()
  return (
    <Pressable style={styles.item} onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })} {...hoverRow}>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.next_step === null ? null : (
          <Text style={styles.itemNext} numberOfLines={1}>
            {t('下一步：{step}', { step: item.next_step })}
          </Text>
        )}
      </View>
      <Text style={styles.side}>{itemStatus[item.status].label}</Text>
    </Pressable>
  )
}

// 会话：取 Orca 快照里的 worktree；status 是 Orca 的开放集合，原样显示
function Sessions({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Section title={t('会话')} right={null} empty={snapshot.worktrees.length === 0}>
      {snapshot.worktrees.map((w) => (
        <View key={w.path} style={styles.item}>
          <View style={styles.itemText}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {w.name}
              {w.status === '' ? null : <Text style={styles.wtStatus}>{`  ${w.status}`}</Text>}
            </Text>
            {w.last_output === '' ? null : (
              <Text style={styles.itemNext} numberOfLines={1}>
                {w.last_output}
              </Text>
            )}
          </View>
          {w.last_activity_at === null ? null : <Text style={styles.time}>{ago(w.last_activity_at)}</Text>}
        </View>
      ))}
    </Section>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  split: { flex: 1, flexDirection: 'row' },
  plist: { width: dt.width.projectList, flexGrow: 0, borderRightWidth: 1, borderRightColor: overlay.hair },
  plistBody: { paddingVertical: 8, paddingHorizontal: 8, gap: 2 },
  group: { ...font.medium, fontSize: size.small, color: colors.tx3, paddingTop: 12, paddingBottom: 4, paddingHorizontal: 10 },
  none: { ...font.regular, fontSize: size.secondary, color: colors.tx3, paddingHorizontal: 10, paddingVertical: 8 },
  pi: { flexDirection: 'row', alignItems: 'center', gap: 8, height: dt.height.row1, paddingHorizontal: 10, borderRadius: dt.radius.row },
  piOn: { backgroundColor: overlay.selected },
  piText: { ...font.regular, flex: 1, fontSize: size.body, color: colors.tx },
  piTextOn: font.medium,
  sep: { height: 1, backgroundColor: overlay.rowLine, marginVertical: 8, marginHorizontal: 10 },
  detail: { flex: 1, minWidth: 0 },
  detailScroll: { flex: 1, borderTopWidth: 1, borderTopColor: 'transparent' },
  detailLine: { borderTopColor: overlay.hair },
  detailBody: { paddingHorizontal: dt.space.pageX, paddingTop: dt.space.pageTop, paddingBottom: 48 },
  column: { width: '100%', maxWidth: dt.width.read, alignSelf: 'center', gap: dt.space.section },
  head: { gap: 4 },
  kicker: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { ...font.semibold, flexShrink: 1, fontSize: size.page, lineHeight: dt.line.page, color: colors.tx },
  pillRow: { flexDirection: 'row', marginTop: 4 },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: dt.height.row2, paddingVertical: dt.space.rowV, paddingHorizontal: dt.space.rowH },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { ...font.medium, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx },
  itemNext: { ...font.regular, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2 },
  wtStatus: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  side: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  time: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  records: { gap: 4 },
  recordsHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 6, marginLeft: -6, borderRadius: dt.radius.btn },
  recordsTitle: { ...font.medium, fontSize: size.secondary, color: colors.tx2 },
})
