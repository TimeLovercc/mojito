import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { X } from 'lucide-react-native'
import { actions } from '../api/client'
import type { MapOrigin, Project, ProjectsList, ResearchMap } from '../api/types'
import { projectActions, useAct } from '../components/Decision'
import { ResearchCard, RunBox } from '../components/ResearchCard'
import { StaleBanner } from '../components/Screen'
import { t } from '../i18n'
import { LIFE, RUN, STAGE, both, branchColor, decisionsOf, originPrinciples, placeName, placeProjects, placesOf, runOf, type Placed } from '../research'
import { colors, font, isDark, overlay, size, txAlpha } from '../theme'
import { when } from '../time'
import { trackAction, useScreenIds, useViewTracking } from '../usage'
import { useHub } from '../use-hub'
import { useHover } from '../hover'
import { colResize } from '../web-data'
import { useChatSubject } from '../wide'
import { Menu } from './Menu'
import { TopBarD } from './TopBar'

// 电脑项目页 = 研究地图（design.md 8.13，照研究地图演示页）：一张横向思维导图，根在左，方向、叶子、起点、项目依次往右；
// 方向节点点一下收起 / 展开；项目节点有运行状态方块、阶段和待你决定数；"灵感收件箱"挂在根下。点根节点看总原则，
// 点起点看它的整句、对应原则和长出来的项目，点项目或收件箱看卡片，都在右边抽屉（components/ResearchCard）。
// 顶栏右边"只看进行中的"开关和选中项目的"⋯"（暂停 / 完成 / 恢复）
type Sel = { kind: 'project'; id: string } | { kind: 'origin'; id: string } | { kind: 'inbox' } | { kind: 'principles' }

export function ResearchMapWide() {
  const map = useHub<ResearchMap>('/research-map')
  const open = useHub<ProjectsList>('/projects')
  const done = useHub<ProjectsList>('/projects?status=done')
  const lists = both(open, done)
  const [sel, setSel] = useState<Sel | null>(null)
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const drawer = useDrawerWidth()
  useViewTracking('projects')
  const ready = map.data !== null && lists.data !== null
  const { placed, missing } = ready
    ? placeProjects(map.data!, [...lists.data!.a.projects, ...lists.data!.b.projects])
    : { placed: [], missing: [] }
  const picked = sel !== null && sel.kind === 'project' ? placed.find((x) => x.project.id === sel.id) : undefined
  const running = placed.filter((x) => runOf(x.project, x.area === LIFE) === 'running').length
  const toggle = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }
  return (
    <View style={styles.page}>
      <TopBarD
        title={t('项目')}
        sub={ready ? t('{n} 个', { n: placed.length }) : null}
        back={null}
        tools={
          <View style={styles.tools}>
            <RunningToggle on={onlyRunning} n={running} onPress={() => setOnlyRunning(!onlyRunning)} />
            {picked === undefined ? null : <ProjectMenu project={picked.project} />}
          </View>
        }
        column={null}
        scrolled={false}
      />
      <View style={styles.split}>
        <View style={styles.mapPane}>
          <StaleBanner view={map} />
          <StaleBanner view={lists} />
          {!ready ? null : (
            <ScrollView style={styles.fill} contentContainerStyle={styles.mapScroll}>
              <ScrollView horizontal contentContainerStyle={styles.mapScroll}>
                <MindMap
                  map={map.data!}
                  placed={placed}
                  onlyRunning={onlyRunning}
                  collapsed={collapsed}
                  onToggle={toggle}
                  sel={sel}
                  onSelect={setSel}
                />
              </ScrollView>
              {missing.length === 0 ? null : (
                <Text style={styles.missing}>{t('地图文件里有 {n} 个项目在 hub 里找不到：{ids}', { n: missing.length, ids: missing.join('、') })}</Text>
              )}
            </ScrollView>
          )}
        </View>
        {sel === null || (sel.kind === 'project' && picked === undefined) ? null : (
          <View style={[styles.drawer, { width: drawer.width }]}>
            <View style={styles.handle} {...drawer.handlers} {...colResize}>
              <View style={styles.handleLine} />
            </View>
            <CloseBtn onPress={() => setSel(null)} />
            <ScrollView contentContainerStyle={styles.drawerBody}>
              {sel.kind === 'inbox' ? (
                <Inbox map={map.data!} />
              ) : sel.kind === 'principles' ? (
                <Principles map={map.data!} />
              ) : sel.kind === 'origin' ? (
                <OriginDrawer map={map.data!} id={sel.id} placed={placed} onSelect={setSel} />
              ) : (
                <ProjectDrawer item={picked!} map={map.data!} />
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  )
}

// 卡片抽屉的宽度：拖左边的竖条改，记在本机（localStorage，换台电脑重新拖）；地图至少留 MAP_MIN，抽屉至少 DRAWER_MIN
const DRAWER_KEY = 'mojito.researchDrawerWidth'
const DRAWER_FIRST = 560
const DRAWER_MIN = 380
const MAP_MIN = 320
const SIDEBAR = 220
function useDrawerWidth() {
  const dims = useWindowDimensions()
  const [stored, setStored] = useState(() => {
    const saved = window.localStorage.getItem(DRAWER_KEY)
    return saved === null ? DRAWER_FIRST : Number(saved)
  })
  const start = useRef({ x: 0, width: 0 })
  const max = Math.max(DRAWER_MIN, dims.width - SIDEBAR - MAP_MIN)
  const width = Math.min(max, Math.max(DRAWER_MIN, stored))
  const handlers = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e: GestureResponderEvent) => {
      start.current = { x: e.nativeEvent.pageX, width }
    },
    onResponderMove: (e: GestureResponderEvent) => {
      setStored(Math.min(max, Math.max(DRAWER_MIN, start.current.width + start.current.x - e.nativeEvent.pageX)))
    },
    onResponderRelease: () => window.localStorage.setItem(DRAWER_KEY, String(Math.round(width))),
    onResponderTerminationRequest: () => false,
  }
  return { width, handlers }
}

function CloseBtn({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover()
  return (
    <Pressable onPress={onPress} {...hover} style={[styles.close, hovered && styles.closeHover]} accessibilityLabel={t('关闭')}>
      <X size={16} color={hovered ? colors.tx : colors.tx2} />
    </Pressable>
  )
}

function RunningToggle({ on, n, onPress }: { on: boolean; n: number; onPress: () => void }) {
  const [hovered, hover] = useHover()
  return (
    <Pressable onPress={onPress} {...hover} style={[styles.toggle, hovered && styles.toggleHover, on && styles.toggleOn]}>
      <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{t('只看进行中的（{n}）', { n })}</Text>
    </Pressable>
  )
}

function ProjectDrawer({ item, map }: { item: Placed; map: ResearchMap }) {
  const p = item.project
  useScreenIds(null, p.id)
  useChatSubject({ kind: 'project', id: p.id, title: p.title })
  return <ResearchCard key={p.id} project={p} place={placeName(map, item.area)} life={item.area === LIFE} chats={item.chats} />
}

function Principles({ map }: { map: ResearchMap }) {
  return (
    <View style={styles.inbox}>
      <Text style={styles.inboxTitle}>{t('总原则')}</Text>
      <Text style={styles.inboxSub}>{t('{n} 条，不绑定具体场景', { n: map.principles.length })}</Text>
      {map.principles.map((p, i) => (
        <View key={p.id} style={styles.idea}>
          <Text style={styles.ideaText}>{`${i + 1}. ${p.label}`}</Text>
          <Text style={styles.longText}>{p.text}</Text>
        </View>
      ))}
    </View>
  )
}

function originOf(map: ResearchMap, id: string): { o: MapOrigin; leaf: string } {
  for (const a of map.areas) for (const l of a.children) for (const o of l.origins) if (o.id === id) return { o, leaf: l.id }
  throw new Error(`研究地图里没有起点 ${id}`)
}

function OriginDrawer({ map, id, placed, onSelect }: { map: ResearchMap; id: string; placed: Placed[]; onSelect: (s: Sel) => void }) {
  const { o, leaf } = originOf(map, id)
  const rests = originPrinciples(map, o)
  const list = placed.filter((x) => x.area === id)
  return (
    <View style={styles.inbox}>
      <Text style={styles.inboxTitle}>{o.label}</Text>
      <Text style={styles.inboxSub}>{t('起点 · {place}', { place: placeName(map, leaf) })}</Text>
      <Text style={styles.longText}>{o.text}</Text>
      {rests === null ? null : <Text style={styles.ideaMeta}>{t('对应原则：{list}', { list: rests })}</Text>}
      <Text style={styles.section}>{t('从这里长出来的项目')}</Text>
      {list.map((x) => (
        <OriginProject key={x.project.id} item={x} onPress={() => onSelect({ kind: 'project', id: x.project.id })} />
      ))}
    </View>
  )
}

function OriginProject({ item: x, onPress }: { item: Placed; onPress: () => void }) {
  const [hovered, hover] = useHover()
  const run = runOf(x.project, false)
  return (
    <Pressable onPress={onPress} {...hover} style={[styles.originProj, hovered && styles.nodeHover]}>
      <RunBox run={run} small />
      <Text style={styles.projText} numberOfLines={1}>
        {x.project.title}
      </Text>
    </Pressable>
  )
}

function Inbox({ map }: { map: ResearchMap }) {
  return (
    <View style={styles.inbox}>
      <Text style={styles.inboxTitle}>{t('灵感收件箱')}</Text>
      <Text style={styles.inboxSub}>{t('还没立项的想法，{n} 条', { n: map.inbox.length })}</Text>
      {map.inbox.map((x, i) => (
        <View key={i} style={styles.idea}>
          <Text style={styles.ideaText}>{x.text}</Text>
          {x.area === null ? null : <Text style={styles.ideaMeta}>{t('建议放在 {place}', { place: placeName(map, x.area) })}</Text>}
          {x.note === null ? null : <Text style={styles.ideaMeta}>{x.note}</Text>}
          <Text style={styles.ideaMeta}>{`${x.source} · ${when(x.at)}`}</Text>
        </View>
      ))}
    </View>
  )
}

// "⋯"：该状态下现有的动作（暂停 / 完成 / 恢复）
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

// ---------------------------------------------------------------- 导图排版
// 节点宽度用 canvas 量字（电脑版只跑在网页里），高度按种类固定；排版同演示页：每个节点的子树高度自下而上算好，
// 子节点在父节点右边 HGAP 处竖着排开、整体对齐父节点中线；方向节点之间多留一点空

type Kind = 'root' | 'inbox' | 'area' | 'leaf' | 'origin' | 'project'
type Node = {
  kind: Kind
  key: string
  color: string
  children: Node[]
  w: number
  h: number
  x: number
  y: number
  sh: number
  label: string
  count: number
  pending: number
  placed: Placed | null
}

const HGAP = 44
const PAD = 24
const UI_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif'
const NODE = {
  root: { h: 50, title: size.title, sub: size.small },
  inbox: { h: 30, title: size.secondary + 1 },
  area: { h: 30, title: size.secondary + 1 },
  leaf: { h: 24, title: size.small + 1 },
  origin: { h: 26, title: size.small + 1 },
  project: { h: 28, title: size.secondary, stage: size.small - 1 },
}
const gapFor = (n: Node) => (n.kind === 'root' ? 16 : n.kind === 'area' ? 8 : 6)

let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string, px: number, weight: number): number {
  if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d')
  if (measureCtx === null) throw new Error('量字用的 canvas 拿不到 2d 上下文')
  measureCtx.font = `${weight} ${px}px ${UI_FONT}`
  return Math.ceil(measureCtx.measureText(text).width) + 2
}

const badgeW = (n: number) => (n === 0 ? 0 : 6 + textWidth(String(n), size.small - 1, 600) + 8)

function sizeOf(n: Node): { w: number; h: number } {
  switch (n.kind) {
    case 'root':
      return { w: 36 + Math.max(textWidth(n.label, NODE.root.title, 600), textWidth(t('{n} 个项目', { n: n.count }), NODE.root.sub, 400)), h: NODE.root.h }
    case 'inbox':
    case 'area':
      return { w: 28 + textWidth(n.label, NODE.area.title, 600) + 6 + textWidth(String(n.count), size.small, 400) + badgeW(n.pending), h: NODE.area.h }
    case 'leaf':
      return { w: 10 + textWidth(n.label, NODE.leaf.title, 600), h: NODE.leaf.h }
    case 'origin':
      return { w: 22 + textWidth(n.label, NODE.origin.title, 500), h: NODE.origin.h }
    case 'project': {
      const c = n.placed!.project.overview
      const stage = c === null || c.card === null ? '' : STAGE[c.card.stage]
      return {
        w: 24 + 14 + 6 + textWidth(n.label, NODE.project.title, 500) + (stage === '' ? 0 : 6 + textWidth(stage, NODE.project.stage, 400)) + badgeW(n.pending),
        h: NODE.project.h,
      }
    }
  }
}

function buildTree(map: ResearchMap, placed: Placed[], onlyRunning: boolean, collapsed: Set<string>): Node {
  const node = (kind: Kind, key: string, color: string, label: string, children: Node[], extra: Partial<Node>): Node => ({
    kind, key, color, label, children, w: 0, h: 0, x: 0, y: 0, sh: 0, count: 0, pending: 0, placed: null, ...extra,
  })
  const shown = (x: Placed) => !onlyRunning || runOf(x.project, x.area === LIFE) === 'running'
  const projectsAt = (place: string, color: string) =>
    placed
      .filter((x) => x.area === place && shown(x))
      .map((x) => node('project', `p:${x.project.id}`, color, x.project.title, [], { placed: x, pending: decisionsOf(x.project) }))
  const areas: Node[] = []
  map.areas.forEach((a, i) => {
    const color = branchColor(i)
    const places = placesOf(a)
    const inArea = placed.filter((x) => places.includes(x.area) && shown(x))
    // 叶子下面先挂直接放在叶子上的项目，再挂起点（起点下是从它长出来的项目）
    const origins = (os: MapOrigin[]) =>
      os
        .map((o) => node('origin', `o:${o.id}`, color, o.label, projectsAt(o.id, color), {}))
        .filter((o) => !onlyRunning || o.children.length > 0)
    const kids =
      a.children.length === 0
        ? projectsAt(a.id, color)
        : a.children
            .map((l) => node('leaf', `l:${l.id}`, color, l.name, [...projectsAt(l.id, color), ...origins(l.origins)], {}))
            .filter((l) => !onlyRunning || l.children.length > 0)
    if (onlyRunning && kids.length === 0) return
    const key = `a:${a.id}`
    areas.push(
      node('area', key, color, a.name, collapsed.has(key) ? [] : kids, {
        count: inArea.length,
        pending: inArea.reduce((n, x) => n + decisionsOf(x.project), 0),
      }),
    )
  })
  const inbox = node('inbox', 'inbox', colors.tx3, t('灵感收件箱'), [], { count: map.inbox.length })
  return node('root', 'root', colors.tx, t('研究地图'), [inbox, ...areas], { count: placed.length })
}

function layout(root: Node): { nodes: Node[]; W: number; H: number } {
  const nodes: Node[] = []
  const walk = (n: Node) => {
    nodes.push(n)
    const s = sizeOf(n)
    n.w = s.w
    n.h = s.h
    n.children.forEach(walk)
  }
  walk(root)
  const subH = (n: Node): number => {
    n.sh = n.children.length === 0 ? n.h : Math.max(n.h, n.children.reduce((s, c) => s + subH(c), 0) + gapFor(n) * (n.children.length - 1))
    return n.sh
  }
  subH(root)
  const place = (n: Node, x: number, cy: number) => {
    n.x = x
    n.y = cy - n.h / 2
    let top = cy - (n.children.reduce((s, c) => s + c.sh, 0) + gapFor(n) * (n.children.length - 1)) / 2
    for (const c of n.children) {
      place(c, n.x + n.w + (n.kind === 'root' ? HGAP * 1.3 : HGAP), top + c.sh / 2)
      top += c.sh + gapFor(n)
    }
  }
  place(root, 0, 0)
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  for (const n of nodes) {
    n.x += PAD - minX
    n.y += PAD - minY
  }
  return {
    nodes,
    W: Math.max(...nodes.map((n) => n.x + n.w)) + PAD,
    H: Math.max(...nodes.map((n) => n.y + n.h)) + PAD,
  }
}

const EDGE_WIDTH: Record<Kind, number> = { root: 3, area: 2.2, leaf: 1.6, origin: 1.4, inbox: 1.4, project: 1.4 }

function MindMap({
  map,
  placed,
  onlyRunning,
  collapsed,
  onToggle,
  sel,
  onSelect,
}: {
  map: ResearchMap
  placed: Placed[]
  onlyRunning: boolean
  collapsed: Set<string>
  onToggle: (key: string) => void
  sel: Sel | null
  onSelect: (s: Sel) => void
}) {
  const { nodes, W, H } = layout(buildTree(map, placed, onlyRunning, collapsed))
  // 叶子节点是一条下划线，连线接在线上；其余接在节点中线
  const anchorY = (n: Node) => (n.kind === 'leaf' ? n.y + n.h : n.y + n.h / 2)
  const edges = nodes.flatMap((p) =>
    p.children.map((c) => {
      const x1 = p.x + p.w
      const y1 = anchorY(p)
      const x2 = c.x
      const y2 = anchorY(c)
      const mx = (x1 + x2) / 2
      return { key: `${p.key}>${c.key}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, color: c.color, width: EDGE_WIDTH[p.kind], dash: c.kind === 'inbox' }
    }),
  )
  return (
    <View style={{ width: W, height: H }}>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {edges.map((e) => (
          <Path key={e.key} d={e.d} stroke={e.color} strokeWidth={e.width} fill="none" strokeDasharray={e.dash ? '5 5' : undefined} />
        ))}
      </Svg>
      {nodes.map((n) => (
        <View key={n.key} style={{ position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h }}>
          <MapNode node={n} collapsed={collapsed.has(n.key)} sel={sel} onToggle={onToggle} onSelect={onSelect} />
        </View>
      ))}
    </View>
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

function MapNode({
  node: n,
  collapsed,
  sel,
  onToggle,
  onSelect,
}: {
  node: Node
  collapsed: boolean
  sel: Sel | null
  onToggle: (key: string) => void
  onSelect: (s: Sel) => void
}) {
  // 悬停：项目节点边框换成方向的颜色、底色加深一档；方向和收件箱节点底色加深（光标保持箭头）
  const [hovered, hover] = useHover()
  switch (n.kind) {
    case 'root':
      return (
        <Pressable
          onPress={() => onSelect({ kind: 'principles' })}
          {...hover}
          style={[styles.node, styles.root, hovered && styles.rootHover]}
          accessibilityLabel={t('总原则')}
        >
          <Text style={styles.rootTitle}>{n.label}</Text>
          <Text style={styles.rootSub}>{t('{n} 个项目', { n: n.count })}</Text>
        </Pressable>
      )
    case 'inbox':
      return (
        <Pressable
          onPress={() => onSelect({ kind: 'inbox' })}
          {...hover}
          style={[styles.node, styles.pillNode, styles.inboxNode, hovered && styles.nodeHover, sel !== null && sel.kind === 'inbox' && styles.nodeSel]}
        >
          <Text style={styles.areaText}>{n.label}</Text>
          <Text style={styles.count}>{n.count}</Text>
        </Pressable>
      )
    case 'area':
      return (
        <Pressable
          onPress={() => onToggle(n.key)}
          style={[styles.node, styles.pillNode, { borderColor: n.color }, hovered && styles.nodeHover, collapsed && styles.areaFolded]}
          accessibilityLabel={collapsed ? t('展开') : t('收起')}
          {...hover}
        >
          <Text style={[styles.areaText, { color: n.color }]}>{n.label}</Text>
          <Text style={styles.count}>{n.count}</Text>
          <Badge n={n.pending} />
        </Pressable>
      )
    case 'leaf':
      return (
        <View style={[styles.node, styles.leaf, { borderBottomColor: n.color }, n.children.length === 0 && styles.leafEmpty]}>
          <Text style={styles.leafText}>{n.label}</Text>
        </View>
      )
    case 'origin': {
      const id = n.key.slice(2)
      const on = sel !== null && sel.kind === 'origin' && sel.id === id
      return (
        <Pressable
          onPress={() => onSelect({ kind: 'origin', id })}
          {...hover}
          style={[styles.node, styles.origin, { borderColor: n.color }, hovered && styles.nodeHover, on && styles.nodeSel]}
          accessibilityLabel={`${t('起点')} · ${n.label}`}
        >
          <Text style={styles.originText} numberOfLines={1}>
            {n.label}
          </Text>
        </Pressable>
      )
    }
    case 'project': {
      const x = n.placed!
      const run = runOf(x.project, x.area === LIFE)
      const c = x.project.overview
      const on = sel !== null && sel.kind === 'project' && sel.id === x.project.id
      return (
        <Pressable
          onPress={() => onSelect({ kind: 'project', id: x.project.id })}
          style={[styles.node, styles.proj, { borderLeftColor: n.color }, hovered && [styles.nodeHover, { borderColor: n.color }], on && styles.nodeSel]}
          accessibilityLabel={`${x.project.title} · ${RUN[run].label}`}
          {...hover}
        >
          <RunBox run={run} small />
          <Text style={[styles.projText, (run === 'paused' || run === 'stopped' || run === 'unknown') && styles.projDim]} numberOfLines={1}>
            {n.label}
          </Text>
          {c === null || c.card === null ? null : <Text style={styles.stage}>{STAGE[c.card.stage]}</Text>}
          <Badge n={n.pending} />
        </Pressable>
      )
    }
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggle: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center', backgroundColor: overlay.fill },
  toggleHover: { backgroundColor: txAlpha(isDark ? 0.16 : 0.12) },
  toggleOn: { backgroundColor: colors.okSoft },
  toggleText: { ...font.medium, fontSize: size.small, color: colors.tx2 },
  toggleTextOn: { color: colors.ok },
  split: { flex: 1, flexDirection: 'row' },
  mapPane: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  mapScroll: { flexGrow: 1 },
  missing: { ...font.regular, fontSize: size.small, color: colors.warn, paddingHorizontal: 24, paddingBottom: 16 },
  drawer: { backgroundColor: colors.bg },
  // 抽屉左边 9 宽的拖动区，中间 1 宽的线（悬停 / 拖动时变品牌色，见 desktop-css.web.ts）
  handle: { position: 'absolute', left: -4, top: 0, bottom: 0, width: 9, zIndex: 2, alignItems: 'center' },
  handleLine: { width: 1, height: '100%', backgroundColor: overlay.hair },
  close: { position: 'absolute', top: 10, right: 12, zIndex: 1, width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  closeHover: { backgroundColor: txAlpha(isDark ? 0.16 : 0.12) },
  drawerBody: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 48 },
  node: { flexDirection: 'row', alignItems: 'center' },
  root: { flexDirection: 'column', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.tx },
  rootTitle: { ...font.semibold, fontSize: NODE.root.title, color: colors.bg },
  rootSub: { ...font.regular, fontSize: NODE.root.sub, color: colors.bg, opacity: 0.8 },
  rootHover: { opacity: 0.85 },
  origin: { height: '100%', paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderStyle: 'dashed', backgroundColor: colors.card },
  originText: { ...font.medium, fontSize: NODE.origin.title, color: colors.tx2 },
  originProj: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.card },
  longText: { ...font.regular, fontSize: size.body, lineHeight: Math.round(size.body * 1.6), color: colors.tx2 },
  section: { ...font.semibold, fontSize: size.secondary, color: colors.tx, marginTop: 8 },
  pillNode: { height: '100%', paddingHorizontal: 12, gap: 6, borderRadius: 15, borderWidth: 2, backgroundColor: colors.card },
  inboxNode: { borderStyle: 'dashed', borderColor: colors.tx3 },
  areaFolded: { opacity: 0.7, borderStyle: 'dashed' },
  areaText: { ...font.semibold, fontSize: NODE.area.title, color: colors.tx },
  count: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  leaf: { height: '100%', paddingHorizontal: 4, borderBottomWidth: 2 },
  leafEmpty: { opacity: 0.55 },
  leafText: { ...font.semibold, fontSize: NODE.leaf.title, color: colors.tx },
  proj: {
    height: '100%',
    paddingHorizontal: 10,
    gap: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: overlay.hair,
    borderLeftWidth: 3,
    backgroundColor: colors.card,
  },
  nodeHover: { backgroundColor: colors.raised },
  nodeSel: { backgroundColor: overlay.selected },
  projText: { ...font.medium, fontSize: NODE.project.title, color: colors.tx },
  projDim: { color: colors.tx3 },
  stage: { ...font.regular, fontSize: NODE.project.stage, color: colors.tx3 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  badgeText: { ...font.semibold, fontSize: size.small - 1, color: colors.onBrand },
  inbox: { gap: 10 },
  inboxTitle: { ...font.semibold, fontSize: size.page, color: colors.tx },
  inboxSub: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  idea: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: colors.card },
  ideaText: { ...font.medium, fontSize: size.body, lineHeight: Math.round(size.body * 1.5), color: colors.tx },
  ideaMeta: { ...font.regular, fontSize: size.small, lineHeight: 18, color: colors.tx3 },
})
