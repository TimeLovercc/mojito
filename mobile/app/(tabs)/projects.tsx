import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react-native'
import type { PagesList, ProjectsList, ResearchMap } from '../../src/api/types'
import { RunBox } from '../../src/components/ResearchCard'
import { IdeaLab } from '../../src/components/IdeaLab'
import { InspirationInbox } from '../../src/components/InspirationInbox'
import { ResearchEntries, ResearchSkills } from '../../src/components/ResearchSkills'
import { Screen } from '../../src/components/Screen'
import { Card, Filter } from '../../src/components/ui'
import { ResearchMapWide } from '../../src/desktop/ResearchMapWide'
import { t } from '../../src/i18n'
import { LIFE, STAGE, both, branchColor, decisionsOf, originPrinciples, placeProjects, placesOf, runOf, type Placed } from '../../src/research'
import { colors, desktop, font, overlay, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { hoverRow } from '../../src/web-data'
import { useWide } from '../../src/wide'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 项目页 = 研究地图（design.md 8.13）。电脑是横向思维导图（src/desktop/ResearchMapWide.tsx）；手机和其他屏幕是同一棵树的
// 折叠列表：最上面是总原则（默认收起）；方向 → 叶子 → 起点 → 项目，点方向收起 / 展开，点起点展开它的整句和对应原则，
// 点项目进全屏卡片（app/projects/[id].tsx）；顶部入口打开灵感收件箱和研究技能。最上面是"页面"入口（docs/api.md「页面」：手机没有侧边栏，从这里进列表）
export default function ProjectsScreen() {
  const wide = useWide()
  return wide && desktop ? <ResearchMapWide /> : <ProjectTree />
}

function ProjectTree() {
  const map = useHub<ResearchMap>('/research-map')
  const open = useHub<ProjectsList>('/projects')
  const done = useHub<ProjectsList>('/projects?status=done')
  const [panel, setPanel] = useState<'inbox' | 'lab' | 'skills' | null>(null)
  const [labTarget, setLabTarget] = useState<{ idea: string | null; seed: string | null }>({ idea: null, seed: null })
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['principles']))
  // 起点默认只显示短标签，点一下展开整句
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useViewTracking('projects')
  const toggle = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }
  const expand = (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }
  return (
    <Screen view={both(map, both(open, done))} head={{ kind: 'title', title: t('项目') }} top={<PagesEntry />} fab>
      {({ a: m, b: lists }) => {
        const { placed, missing } = placeProjects(m, [...lists.a.projects, ...lists.b.projects])
        const shown = (x: Placed) => !onlyRunning || runOf(x.project, x.area === LIFE) === 'running'
        const running = placed.filter((x) => runOf(x.project, x.area === LIFE) === 'running').length
        return (
          <View style={styles.col}>
            <ResearchEntries count={m.inbox.length} selected={panel} onSelect={(kind) => { setLabTarget({ idea: null, seed: null }); setPanel(panel === kind ? null : kind) }} />
            {panel !== null ? (
              <View style={styles.col}>
                <Pressable accessibilityRole="button" onPress={() => setPanel(null)} style={styles.returnButton} {...hoverRow}>
                  <Text style={styles.returnText}>{t('返回研究地图')}</Text>
                </Pressable>
                {panel === 'skills' ? <ResearchSkills /> : panel === 'lab' ? <IdeaLab key={`${labTarget.idea}:${labTarget.seed}`} initialIdea={labTarget.idea} initialSeed={labTarget.seed} /> : <InspirationInbox map={m} showTitle onIdea={id => { setLabTarget({ idea: id, seed: null }); setPanel('lab') }} onExplore={id => { setLabTarget({ idea: null, seed: id }); setPanel('lab') }} />}
              </View>
            ) : (
              <>
                <View style={styles.filters}>
                  <Filter label={t('只看进行中的（{n}）', { n: running })} on={onlyRunning} onPress={() => setOnlyRunning(!onlyRunning)} />
                </View>
                <Card>
                  <Pressable onPress={() => toggle('principles')} style={styles.areaHead} {...hoverRow}>
                    <View style={[styles.bar, { backgroundColor: colors.tx }]} />
                    <Text style={styles.areaName}>{t('总原则')}</Text>
                    <Text style={styles.count}>{m.principles.length}</Text>
                    <View style={styles.grow} />
                    {collapsed.has('principles') ? <ChevronRight size={16} color={colors.tx3} /> : <ChevronDown size={16} color={colors.tx3} />}
                  </Pressable>
                  {collapsed.has('principles')
                    ? null
                    : m.principles.map((p, i) => (
                        <View key={p.id} style={styles.idea}>
                          <Text style={styles.ideaText}>{`${i + 1}. ${p.label}`}</Text>
                          <Text style={styles.principleText}>{p.text}</Text>
                        </View>
                      ))}
                </Card>
                {m.areas.map((a, i) => {
                  const color = branchColor(i)
                  const places = placesOf(a)
                  const inArea = placed.filter((x) => places.includes(x.area) && shown(x))
                  if (onlyRunning && inArea.length === 0) return null
                  const key = `a:${a.id}`
                  const folded = collapsed.has(key)
                  const pending = inArea.reduce((n, x) => n + decisionsOf(x.project), 0)
                  return (
                    <Card key={a.id}>
                      <Pressable onPress={() => toggle(key)} style={styles.areaHead} {...hoverRow}>
                        <View style={[styles.bar, { backgroundColor: color }]} />
                        <Text style={[styles.areaName, { color }]}>{a.name}</Text>
                        <Text style={styles.count}>{inArea.length}</Text>
                        <Badge n={pending} />
                        <View style={styles.grow} />
                        {folded ? <ChevronRight size={16} color={colors.tx3} /> : <ChevronDown size={16} color={colors.tx3} />}
                      </Pressable>
                      {folded
                        ? null
                        : a.children.length === 0
                          ? inArea.map((x) => <ProjectLine key={x.project.id} item={x} deep={false} />)
                          : a.children.map((l) => {
                              const direct = inArea.filter((x) => x.area === l.id)
                              const origins = l.origins
                                .map((o) => ({ o, list: inArea.filter((x) => x.area === o.id) }))
                                .filter((g) => !onlyRunning || g.list.length > 0)
                              if (onlyRunning && direct.length === 0 && origins.length === 0) return null
                              return (
                                <View key={l.id}>
                                  <Text style={[styles.leaf, { borderBottomColor: color }]}>{l.name}</Text>
                                  {direct.length === 0 && origins.length === 0 ? <Text style={styles.empty}>{t('空')}</Text> : null}
                                  {direct.map((x) => <ProjectLine key={x.project.id} item={x} deep={false} />)}
                                  {origins.map(({ o, list }) => {
                                    const open = expanded.has(o.id)
                                    const rests = originPrinciples(m, o)
                                    return (
                                      <View key={o.id}>
                                        <Pressable onPress={() => expand(o.id)} style={styles.origin} {...hoverRow}>
                                          <View style={[styles.originDot, { borderColor: color }]} />
                                          <Text style={styles.originLabel}>{o.label}</Text>
                                          <View style={styles.grow} />
                                          {open ? <ChevronDown size={14} color={colors.tx3} /> : <ChevronRight size={14} color={colors.tx3} />}
                                        </Pressable>
                                        {open ? (
                                          <View style={styles.originBody}>
                                            <Text style={styles.originText}>{o.text}</Text>
                                            {rests === null ? null : <Text style={styles.ideaMeta}>{t('对应原则：{list}', { list: rests })}</Text>}
                                          </View>
                                        ) : null}
                                        {list.map((x) => <ProjectLine key={x.project.id} item={x} deep />)}
                                      </View>
                                    )
                                  })}
                                </View>
                              )
                            })}
                    </Card>
                  )
                })}
                {missing.length === 0 ? null : (
                  <Text style={styles.missing}>{t('地图文件里有 {n} 个项目在 hub 里找不到：{ids}', { n: missing.length, ids: missing.join('、') })}</Text>
                )}
              </>
            )}
          </View>
        )
      }}
    </Screen>
  )
}

function PagesEntry() {
  const router = useRouter()
  const pages = useHub<PagesList>('/pages')
  return (
    <Card onPress={() => router.push('/pages')}>
      <View style={styles.areaHead}>
        <FileText size={17} color={colors.tx2} strokeWidth={1.8} />
        <Text style={styles.areaName}>{t('页面')}</Text>
        {pages.data === null ? null : <Text style={styles.count}>{pages.data.pages.length}</Text>}
        <View style={styles.grow} />
        <ChevronRight size={16} color={colors.tx3} />
      </View>
    </Card>
  )
}

function ProjectLine({ item: x, deep }: { item: Placed; deep: boolean }) {
  const router = useRouter()
  const run = runOf(x.project, x.area === LIFE)
  const card = x.project.overview === null ? null : x.project.overview.card
  return (
    <Pressable
      style={[styles.proj, deep && styles.projDeep]}
      onPress={() => router.push({ pathname: '/projects/[id]', params: { id: x.project.id } })}
      {...hoverRow}
    >
      <RunBox run={run} small />
      <Text style={[styles.projName, run !== 'running' && run !== 'done' && styles.dim]} numberOfLines={1}>
        {x.project.title}
      </Text>
      {card === null ? null : <Text style={styles.stage}>{STAGE[card.stage]}</Text>}
      <Badge n={decisionsOf(x.project)} />
      <View style={styles.grow} />
      <ChevronRight size={15} color={colors.tx3} />
    </Pressable>
  )
}

function Badge({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{n}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  col: { gap: 12 },
  returnButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8 },
  returnText: { ...font.medium, fontSize: size.secondary, color: colors.tx2 },
  filters: { flexDirection: 'row' },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  bar: { width: 4, height: 18, borderRadius: 2 },
  areaName: { ...font.semibold, fontSize: size.title, color: colors.tx },
  count: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  grow: { flex: 1 },
  leaf: {
    ...font.semibold,
    alignSelf: 'flex-start',
    fontSize: size.secondary,
    color: colors.tx2,
    marginLeft: 26,
    marginTop: 4,
    marginBottom: 2,
    paddingBottom: 2,
    borderBottomWidth: 2,
  },
  empty: { ...font.regular, fontSize: size.small, color: colors.tx3, marginLeft: 26, paddingVertical: 6 },
  proj: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingLeft: 26,
    paddingRight: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: overlay.rowLine,
  },
  projName: { ...font.medium, flexShrink: 1, fontSize: size.body, color: colors.tx },
  projDeep: { paddingLeft: 42 },
  dim: { color: colors.tx3 },
  origin: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingLeft: 26, paddingRight: 14 },
  originDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  originLabel: { ...font.semibold, flexShrink: 1, fontSize: size.secondary, color: colors.tx2 },
  originBody: { gap: 3, paddingLeft: 42, paddingRight: 14, paddingBottom: 8 },
  originText: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.55), color: colors.tx2 },
  principleText: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.55), color: colors.tx2 },
  stage: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  badgeText: { ...font.semibold, fontSize: size.small - 1, color: colors.onBrand },
  idea: { gap: 3, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: overlay.rowLine },
  ideaText: { ...font.medium, fontSize: size.body, lineHeight: Math.round(size.body * 1.5), color: colors.tx },
  ideaMeta: { ...font.regular, fontSize: size.small, lineHeight: 18, color: colors.tx3 },
  missing: { ...font.regular, fontSize: size.small, color: colors.warn },
})
