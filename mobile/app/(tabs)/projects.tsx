import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import type { GoalsList, ItemCategory, ItemsList, ProjectsList } from '../../src/api/types'
import { ItemRow } from '../../src/components/ItemRow'
import { ProjectRow } from '../../src/components/ProjectCard'
import { Screen, StaleBanner } from '../../src/components/Screen'
import { Btn, Card, Empty, Rows, Section, Seg, Tag } from '../../src/components/ui'
import { killState } from '../../src/labels'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { useWide } from '../../src/wide'
import { TopBar } from '../../src/components/Screen'
import { colors, desktop, font, size } from '../../src/theme'
import { ProjectsWide } from '../../src/desktop/ProjectsWide'
import type { Project } from '../../src/api/types'
import { ProjectPane } from '../projects/[id]'
import { hoverRow } from '../../src/web-data'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

const OPEN = new Set(['active', 'waiting_you', 'scheduled'])

// 项目面板：研究 / 生活两组，不属于任何项目的进行中事项归入"其他"。电脑宽屏见 src/desktop/ProjectsWide.tsx，其他宽屏（iPad）见 WideProjects
export default function ProjectsScreen() {
  const wide = useWide()
  return wide ? (desktop ? <ProjectsWide /> : <WideProjects />) : <PhoneProjects />
}

function PhoneProjects() {
  const [area, setArea] = useState<ItemCategory>('research')
  const projects = useHub<ProjectsList>(`/projects?area=${area}`)
  const items = useHub<ItemsList>('/items')
  const goals = useHub<GoalsList>('/goals')
  const router = useRouter()
  useViewTracking('projects')
  const seg = (
    <Seg<ItemCategory>
      options={[
        ['research', t('研究')],
        ['life', t('生活')],
      ]}
      value={area}
      onChange={setArea}
    />
  )
  const others =
    items.data === null ? null : items.data.items.filter((i) => i.project_id === null && i.category === area && OPEN.has(i.status))
  return (
    <Screen view={projects} head={{ kind: 'title', title: t('项目') }} top={seg} fab>
      {({ projects: list }) => (
        <>
          <Section title={t('项目')} right={String(list.length)}>
            {list.length === 0 ? (
              <Empty text={t('这一组还没有项目')} />
            ) : (
              <Card>
                <Rows>
                  {list.map((p) => (
                    <ProjectRow key={p.id} project={p} />
                  ))}
                </Rows>
              </Card>
            )}
          </Section>
          <Section title={t('其他')} right={others === null ? '' : String(others.length)}>
            <StaleBanner view={items} />
            {others === null ? null : others.length === 0 ? (
              <Empty text={t('没有不属于项目的进行中事项')} />
            ) : (
              <Card style={{ paddingVertical: 4 }}>
                <Rows>
                  {others.map((i) => (
                    <ItemRow key={i.id} item={i} goals={goals.data === null ? null : goals.data.goals} showStatus />
                  ))}
                </Rows>
              </Card>
            )}
          </Section>
          <View style={styles.all}>
            <Btn label={t('全部事项')} icon={ChevronRight} onPress={() => router.push('/items')} />
          </View>
        </>
      )}
    </Screen>
  )
}

// 宽屏（内部界面稿（未公开） 第 3 张）：顶栏横跨；左栏按研究 / 生活分组的项目列表（状态点），右边选中项目的详情
function WideProjects() {
  const research = useHub<ProjectsList>('/projects?area=research')
  const life = useHub<ProjectsList>('/projects?area=life')
  const router = useRouter()
  const [picked, setPicked] = useState<string | null>(null)
  useViewTracking('projects')
  const all = [...(research.data === null ? [] : research.data.projects), ...(life.data === null ? [] : life.data.projects)]
  const selected = picked !== null && all.some((p) => p.id === picked) ? picked : all.length === 0 ? null : all[0].id
  const group = (title: string, list: Project[] | null) => (
    <>
      <Text style={styles.group}>{title}</Text>
      {list === null ? null : list.length === 0 ? (
        <Text style={styles.none}>{t('还没有项目')}</Text>
      ) : (
        list.map((p) => (
          <Pressable key={p.id} onPress={() => setPicked(p.id)} style={[styles.pi, p.id === selected && styles.piOn]} {...hoverRow}>
            <Text style={[styles.piText, p.id === selected && font.medium]} numberOfLines={1}>
              {p.title}
            </Text>
            {p.overview === null || p.overview.kill === null ? null : <Tag {...killState[p.overview.kill.state]} />}
            <View style={[styles.dot, { backgroundColor: p.stale ? colors.warn : p.status === 'active' ? colors.ok : colors.tx3 }]} />
          </Pressable>
        ))
      )}
    </>
  )
  return (
    <View style={styles.page}>
      <TopBar head={{ kind: 'title', title: t('项目') }} sub={null} tools={null} syncing={research.syncing || life.syncing} />
      <View style={styles.split}>
        <ScrollView style={styles.plist} contentContainerStyle={styles.plistBody}>
          <StaleBanner view={research} />
          {group(t('研究'), research.data === null ? null : research.data.projects)}
          {group(t('生活'), life.data === null ? null : life.data.projects)}
          <View style={styles.sep} />
          <Pressable onPress={() => router.push('/items')} style={styles.pi}>
            <Text style={styles.piText}>{t('全部事项')}</Text>
            <ChevronRight size={15} color={colors.tx3} />
          </Pressable>
        </ScrollView>
        <View style={styles.detail}>{selected === null ? null : <ProjectPane key={selected} id={selected} head={{ kind: 'none' }} />}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  plist: { width: 260, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.line },
  plistBody: { paddingVertical: 14, paddingHorizontal: 12, gap: 4 },
  group: {
    ...font.regular,
    fontSize: size.small,
    color: colors.tx3,
    letterSpacing: 0.5,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 10,
  },
  none: { ...font.regular, fontSize: size.secondary, color: colors.tx3, paddingHorizontal: 10, paddingVertical: 6 },
  pi: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 },
  piOn: { backgroundColor: colors.raised },
  piText: { ...font.regular, fontSize: size.body, color: colors.tx, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 10, marginHorizontal: 6 },
  detail: { flex: 1, minWidth: 0 },
  all: { flexDirection: 'row', justifyContent: 'center' },
})
