import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { BookOpen, ChevronDown, ChevronRight, FileText, Lightbulb, UserRound } from 'lucide-react-native'
import type { InboxItem, InboxKind, ResearchMap } from '../api/types'
import type { IdeaLabData } from '../api/idea-lab'
import { useHub } from '../use-hub'
import { LabButton, SeedConnections } from './IdeaLab'
import { StaleBanner } from './Screen'
import { useHover } from '../hover'
import { t, tc } from '../i18n'
import { placeName } from '../research'
import { colors, desktop, font, isDark, overlay, size } from '../theme'
import { when } from '../time'

const categories = [
  { kind: 'idea', label: '想法', empty: '还没有收录想法', icon: Lightbulb, color: isDark ? '#d5b16e' : '#886116' },
  { kind: 'paper', label: '论文', empty: '还没有收录论文', icon: FileText, color: isDark ? '#8bacd5' : '#406d9f' },
  { kind: 'author', label: '作者', empty: '还没有收录作者', icon: UserRound, color: isDark ? '#b7a1d6' : '#78559d' },
  { kind: 'blog', label: '博客', empty: '还没有收录博客', icon: BookOpen, color: isDark ? '#80bdb8' : '#357873' },
] as const

// 无 kind 的旧协议记录明确属于想法；类型不从来源文字猜测。
function kindOf(item: InboxItem): InboxKind {
  return 'kind' in item ? item.kind : 'idea'
}

// 仅在显示时拆分；详情仍然使用完整原文，不改写收录内容。
function preview(text: string): { title: string; summary: string | null } {
  const separator = /：|: /.exec(text)
  if (separator === null) return { title: text, summary: null }
  return { title: text.slice(0, separator.index), summary: text.slice(separator.index + separator[0].length).trim() }
}

export function InspirationInbox({ map, showTitle, onIdea, onExplore }: { map: ResearchMap; showTitle: boolean; onIdea: (id: string) => void; onExplore: (id: string) => void }) {
  const lab = useHub<IdeaLabData>('/idea-lab')
  const [selected, setSelected] = useState<InboxKind>('idea')
  const items = map.inbox.filter((item) => kindOf(item) === selected)
  const category = categories.find((entry) => entry.kind === selected)!
  return (
    <View style={styles.container}>
      {showTitle ? <Text style={styles.heading}>{t('灵感收件箱')}</Text> : null}
      <StaleBanner view={lab} />
      {lab.error === null ? null : <LabButton onPress={() => { void lab.refresh() }}>{t('重试')}</LabButton>}
      <View style={styles.categories}>
        {categories.map((entry) => (
          <CategoryTab
            key={entry.kind}
            category={entry}
            count={map.inbox.filter((item) => kindOf(item) === entry.kind).length}
            selected={entry.kind === selected}
            onPress={() => setSelected(entry.kind)}
          />
        ))}
      </View>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <category.icon size={24} color={category.color} />
          <Text style={styles.emptyText}>{t(category.empty)}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <InboxRow key={JSON.stringify([kindOf(item), item.at, item.source, item.text])} item={item} map={map} data={lab.data} onIdea={onIdea} onExplore={onExplore} onRefresh={lab.refresh} />
          ))}
        </View>
      )}
    </View>
  )
}

function CategoryTab({ category, count, selected, onPress }: {
  category: (typeof categories)[number]
  count: number
  selected: boolean
  onPress: () => void
}) {
  const [hovered, hover] = useHover()
  const Icon = category.icon
  return (
    <Pressable
      onPress={onPress}
      {...hover}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
      accessibilityLabel={t('{category}，{n} 条', { category: tc('收件箱', category.label), n: count })}
      style={({ pressed }) => [styles.tab, hovered && styles.hover, selected && styles.selectedTab, selected && { borderColor: category.color }, pressed && styles.pressed]}
    >
      <Icon size={14} color={category.color} />
      <Text style={[styles.tabLabel, selected && { color: category.color }]}>{tc('收件箱', category.label)}</Text>
      <Text style={[styles.count, selected && { color: category.color }]}>{count}</Text>
    </Pressable>
  )
}

function InboxRow({ item, map, data, onIdea, onExplore, onRefresh }: { item: InboxItem; map: ResearchMap; data: IdeaLabData | null; onIdea: (id: string) => void; onExplore: (id: string) => void; onRefresh: () => Promise<void> }) {
  const seed = data === null ? undefined : data.seeds.find(s => s.kind === kindOf(item) && s.source === item.source && new Date(s.at).getTime() === new Date(item.at).getTime())
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hovered, hover] = useHover()
  const { title, summary } = preview(item.text)
  return (
    <View style={[styles.card, expanded && styles.expandedCard, focused && styles.focusedCard]}>
      <Pressable
        {...hover}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        accessibilityLabel={title}
        accessibilityHint={expanded ? t('收起完整内容') : t('展开完整内容')}
        style={({ pressed }) => [styles.row, hovered && styles.hover, pressed && styles.pressed]}
      >
        <View style={styles.preview}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {!expanded && summary !== null && summary !== '' ? <Text style={styles.summary} numberOfLines={1}>{summary}</Text> : null}
        {seed === undefined ? null : <Text style={styles.meta}>{t('关联 {n} 个想法', { n: seed.idea_ids.length })}{seed.last_explored_at === null ? '' : ` · ${t('最近探索：{at}', { at: when(seed.last_explored_at) })}`}</Text>}
        </View>
        {expanded ? <ChevronDown size={16} color={colors.tx3} /> : <ChevronRight size={16} color={colors.tx3} />}
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <Text selectable style={styles.body}>{item.text}</Text>
          {seed === undefined || data === null ? null : <SeedConnections seed={seed} data={data} onIdea={onIdea} onExplore={onExplore} onRefresh={onRefresh} />}
          {item.area === null ? null : <Text selectable style={styles.meta}>{t('建议放在 {place}', { place: placeName(map, item.area) })}</Text>}
          {item.note === null ? null : <Text selectable style={styles.note}>{item.note}</Text>}
          <View style={styles.source}>
            <Text selectable style={styles.meta}>{item.source}</Text>
            <Text style={styles.date}>{when(item.at)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  heading: { ...font.semibold, fontSize: size.page, color: colors.tx },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexGrow: 1, gap: 5, minHeight: desktop ? 34 : 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: overlay.hair },
  tabLabel: { ...font.medium, fontSize: size.secondary, color: colors.tx2 },
  count: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  selectedTab: { backgroundColor: overlay.fill },
  hover: { backgroundColor: overlay.hover },
  pressed: { backgroundColor: overlay.pressed },
  list: { gap: 6 },
  card: { borderWidth: 1, borderColor: overlay.hair, borderRadius: 9, backgroundColor: colors.card, overflow: 'hidden' },
  expandedCard: { borderColor: colors.tx3 },
  focusedCard: { borderColor: colors.brand },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: desktop ? 10 : 12, minHeight: 44 },
  preview: { flex: 1, minWidth: 0, gap: 3 },
  title: { ...font.medium, fontSize: size.body, lineHeight: Math.round(size.body * 1.4), color: colors.tx },
  summary: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.4), color: colors.tx2 },
  details: { borderTopWidth: 1, borderTopColor: overlay.rowLine, padding: 12, gap: 10 },
  body: { ...font.regular, fontSize: size.body, lineHeight: Math.round(size.body * 1.6), color: colors.tx },
  note: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.6), color: colors.tx2 },
  meta: { ...font.regular, fontSize: size.small, lineHeight: Math.round(size.small * 1.5), color: colors.tx3 },
  source: { gap: 4 },
  date: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  empty: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  emptyText: { ...font.regular, fontSize: size.secondary, color: colors.tx3 },
})
