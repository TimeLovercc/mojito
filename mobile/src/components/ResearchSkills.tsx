import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Copy, FlaskConical, Lightbulb } from 'lucide-react-native'
import { HubError } from '../api/client'
import type { ResearchSkill, ResearchSkillsSnapshot } from '../api/types'
import { t } from '../i18n'
import { colors, desktop, font, isDark, overlay, size } from '../theme'
import { when } from '../time'
import { useHub } from '../use-hub'
import { hoverRow, linkCursor } from '../web-data'
import { StaleBanner } from './Screen'

type EntryKind = 'inbox' | 'lab' | 'skills'
const accents = { inbox: isDark ? '#d5b16e' : '#886116', skills: isDark ? '#b7a1d6' : '#78559d', lab: isDark ? '#80bdb8' : '#357873' }

export function ResearchEntries({ count, selected, onSelect }: { count: number | null; selected: EntryKind | null; onSelect: (kind: EntryKind) => void }) {
  return (
    <View style={styles.entries}>
      {(['inbox', 'lab', 'skills'] as const).map((kind) => {
        const Icon = kind === 'inbox' ? Lightbulb : kind === 'lab' ? FlaskConical : BookOpen
        const on = selected === kind
        const disabled = kind === 'inbox' && count === null
        return (
          <Pressable key={kind} accessibilityRole="button" accessibilityState={{ expanded: on, disabled }} aria-expanded={on} disabled={disabled}
            {...(Platform.OS === 'web' ? { 'aria-pressed': on } : {})}
            onPress={() => onSelect(kind)} {...hoverRow} style={[styles.entry, disabled && styles.disabled, on && { borderColor: accents[kind], backgroundColor: overlay.fill }]}>
            <Icon size={15} color={accents[kind]} />
            <Text style={styles.entryLabel}>{kind === 'inbox' ? t('灵感收件箱') : kind === 'lab' ? 'Idea Lab' : t('研究技能')}</Text>
            {kind === 'inbox' && count !== null ? <Text style={styles.count}>{count}</Text> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

export function ResearchSkills() {
  const view = useHub<ResearchSkillsSnapshot>('/research-skills')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState('SKILL.md')
  const skill = view.data === null || selected === null ? undefined : view.data.skills.find((item) => item.id === selected)
  const unsynced = view.error instanceof HubError && view.error.status === 404
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{t('研究技能')}</Text>
      <Text style={styles.description}>{t('与 Claude Code 和 Codex 共用的方法，点击阅读完整内容。')}</Text>
      {unsynced ? <Text style={styles.description}>{t('技能尚未同步，首次同步后即可阅读。')}</Text> : <StaleBanner view={view} />}
      {view.error === null ? null : <Action label={t('重试')} onPress={() => { void view.refresh() }} />}
      {view.data === null && view.error === null ? <ActivityIndicator color={colors.tx2} /> : null}
      {view.data === null ? null : skill === undefined ? (
        <View style={styles.panel}>
          {view.data.skills.length === 0 ? <Text style={styles.description}>{t('还没有研究技能')}</Text> : null}
          {view.data.skills.filter(item => ['research-idea-funnel', 'research-experiments', 'research-review', 'paper-writing'].includes(item.id)).map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => { setSelectedPath('SKILL.md'); setSelected(item.id) }} {...hoverRow} style={styles.card}>
              <BookOpen size={18} color={accents.skills} />
              <View style={styles.preview}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.description}>{item.summary}</Text>
              </View>
              <ChevronRight size={16} color={colors.tx3} />
            </Pressable>
          ))}
        </View>
      ) : <SkillReader key={`${skill.id}:${selectedPath}`} skill={skill} skills={view.data.skills} initialPath={selectedPath} onNavigate={(id, path) => { setSelected(id); setSelectedPath(path) }} onBack={() => setSelected(null)} />}
    </View>
  )
}

function SkillReader({ skill, skills, initialPath, onNavigate, onBack }: { skill: ResearchSkill; skills: ResearchSkill[]; initialPath: string; onNavigate: (id: string, path: string) => void; onBack: () => void }) {
  const [path, setPath] = useState(initialPath)
  const [raw, setRaw] = useState(false)
  const [history, setHistory] = useState(false)
  const [copyResult, setCopyResult] = useState<string | null>(null)
  const file = skill.files.find((entry) => entry.path === path)
  const references = skill.files.filter((entry) => entry.path !== 'SKILL.md')
  const selectFile = (next: string) => { setPath(next); setRaw(false) }
  const copyPath = () => {
    Clipboard.setStringAsync(skill.source_path).then(
      () => setCopyResult(t('已复制路径')),
      (error: unknown) => { if (!(error instanceof Error)) throw error; setCopyResult(t('复制失败：{error}', { error: error.message })) },
    )
  }
  return (
    <View style={styles.panel}>
      <Action label={t('返回技能列表')} onPress={onBack} back />
      <Text style={styles.title}>{skill.title}</Text>
      <Text style={styles.description}>{skill.summary}</Text>
      <Text style={styles.meta}>{t('更新于 {at}', { at: when(skill.updated_at) })}</Text>
      <View style={styles.source}>
        <Text selectable style={styles.path}>{skill.source_path}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('复制源文件路径')} onPress={copyPath} style={styles.copy} {...hoverRow}>
          <Copy size={15} color={colors.tx2} /><Text style={styles.actionText}>{t('复制路径')}</Text>
        </Pressable>
        {copyResult === null ? null : <Text style={styles.meta}>{copyResult}</Text>}
      </View>
      <View style={styles.fold}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: history }} aria-expanded={history} onPress={() => setHistory(!history)} style={styles.foldHead} {...hoverRow}>
          {history ? <ChevronDown size={15} color={colors.tx2} /> : <ChevronRight size={15} color={colors.tx2} />}
          <Text style={styles.actionText}>{t('最近改动')}</Text>
        </Pressable>
        {history ? <View style={styles.history}>
          <Text style={styles.meta}>{t('来自 Git 提交；未提交的内容也会同步到正文。')}</Text>
          {skill.changes.length === 0 ? <Text style={styles.meta}>{t('暂无提交记录')}</Text> : skill.changes.map((change) => (
            <View key={change.revision} style={styles.change}>
              <Text selectable style={styles.description}>{change.summary}</Text>
              <Text selectable style={styles.meta}>{when(change.at)} · {change.revision.slice(0, 8)}</Text>
            </View>
          ))}
        </View> : null}
      </View>
      {references.length === 0 ? null : <View style={styles.references}>
        <Text style={styles.meta}>{t('参考文件')}</Text>
        {references.map((reference) => <Action key={reference.path} label={reference.path} onPress={() => selectFile(reference.path)} />)}
      </View>}
      <View style={styles.readerTop}>
        {path === 'SKILL.md' ? <Text style={styles.fileTitle}>SKILL.md</Text> : <View style={styles.preview}>
          <Action label={t('返回技能正文')} onPress={() => selectFile('SKILL.md')} back />
          <Text selectable style={styles.fileTitle}>{path}</Text>
        </View>}
        <Pressable accessibilityRole="button" accessibilityState={{ selected: raw }} {...(Platform.OS === 'web' ? { 'aria-pressed': raw } : {})}
          onPress={() => setRaw(!raw)} style={styles.action} {...hoverRow}>
          <Text style={styles.actionText}>{raw ? t('阅读视图') : t('查看原文')}</Text>
        </Pressable>
      </View>
      {file === undefined ? <Text style={styles.description}>{t('此文件已不在当前技能快照中，请返回正文。')}</Text> : raw ?
        <Text selectable style={styles.raw}>{file.content}</Text> :
        <SkillMarkdown key={file.path} text={file.content} path={file.path} skill={skill} skills={skills} onFile={(id, next) => { if (id === skill.id) selectFile(next); else onNavigate(id, next) }} />}
    </View>
  )
}

function Action({ label, onPress, back }: { label: string; onPress: () => void; back?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action} {...hoverRow}>
    {back ? <ChevronLeft size={15} color={colors.tx2} /> : null}
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>
}

// 只跳转到已同步的真实文件；跨技能引用使用相同的源路径解析。
function referencePath(href: string, path: string, skill: ResearchSkill, skills: ResearchSkill[]): { id: string; path: string } | null {
  const target = decodeURI(href.split('#')[0])
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null
  const base = skill.source_path.slice(0, -'SKILL.md'.length) + path
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const resolved = '/' + parts.filter(Boolean).join('/')
  for (const candidate of skills) {
    const dir = candidate.source_path.slice(0, -'SKILL.md'.length)
    for (const file of candidate.files) {
      if (dir + file.path === resolved) return { id: candidate.id, path: file.path }
    }
  }
  return null
}

function Inline({ text, path, skill, skills, onFile }: { text: string; path: string; skill: ResearchSkill; skills: ResearchSkill[]; onFile: (id: string, path: string) => void }) {
  const parts: ReactNode[] = []
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s)）\]」]+)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const [whole, code, bold, label, href, url] = match
    const at = match.index
    if (at > last) parts.push(text.slice(last, at))
    if (code !== undefined) parts.push(<Text key={at} style={styles.inlineCode}>{code}</Text>)
    else if (bold !== undefined) parts.push(<Text key={at} style={font.semibold}>{bold}</Text>)
    else {
      const target = href === undefined ? url : href
      const title = label === undefined ? url : label
      const internal = referencePath(target, path, skill, skills)
      const external = /^https?:\/\//.test(target)
      if (internal !== null || external) parts.push(<Text key={at} accessibilityRole="link" style={styles.link} {...linkCursor}
        onPress={() => { if (internal !== null) onFile(internal.id, internal.path); else void Linking.openURL(target) }}>{title}</Text>)
      else parts.push(whole)
    }
    last = at + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function SkillMarkdown({ text, path, skill, skills, onFile }: { text: string; path: string; skill: ResearchSkill; skills: ResearchSkill[]; onFile: (id: string, path: string) => void }) {
  const [metadata, setMetadata] = useState(false)
  const front = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)
  const body = front === null ? text : text.slice(front[0].length)
  const blocks: ReactNode[] = []
  let code: string[] | null = null
  let fence = ''
  for (const [index, line] of body.split('\n').entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (code !== null) {
      if (marker !== null && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        blocks.push(<Text key={index} selectable style={styles.code}>{code.join('\n')}</Text>); code = null
      } else code.push(line)
      continue
    }
    if (marker !== null) { code = []; fence = marker[1]; continue }
    if (line.trim() === '') { blocks.push(<View key={index} style={styles.paragraphGap} />); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    const displayed = heading !== null ? heading[2] : quote !== null ? quote[1] : line
    blocks.push(<Text key={index} selectable style={[styles.body, heading !== null && styles.markdownHeading, quote !== null && styles.quote]}>
      <Inline text={displayed} path={path} skill={skill} skills={skills} onFile={onFile} />
    </Text>)
  }
  if (code !== null) blocks.push(<Text key="unclosed-code" selectable style={styles.code}>{`${fence}\n${code.join('\n')}`}</Text>)
  return <View style={styles.markdown}>
    {front === null ? null : <View style={styles.fold}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: metadata }} aria-expanded={metadata} onPress={() => setMetadata(!metadata)} style={styles.foldHead} {...hoverRow}>
        {metadata ? <ChevronDown size={15} color={colors.tx2} /> : <ChevronRight size={15} color={colors.tx2} />}
        <Text style={styles.actionText}>{t('技能元数据')}</Text>
      </Pressable>
      {metadata ? <Text selectable style={styles.code}>{front[0]}</Text> : null}
    </View>}
    {blocks}
  </View>
}

const styles = StyleSheet.create({
  entries: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: desktop ? 32 : 44, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: overlay.hair },
  entryLabel: { ...font.medium, fontSize: size.secondary, color: colors.tx2 },
  disabled: { opacity: 0.5 },
  count: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  panel: { gap: 14, minWidth: 0 },
  heading: { ...font.semibold, fontSize: size.page, color: colors.tx },
  title: { ...font.semibold, fontSize: size.title, color: colors.tx },
  description: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.55), color: colors.tx2 },
  meta: { ...font.regular, fontSize: size.small, lineHeight: Math.round(size.small * 1.5), color: colors.tx3 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: overlay.hair, backgroundColor: colors.card },
  preview: { flex: 1, minWidth: 0, gap: 5 },
  action: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: desktop ? 32 : 44, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, maxWidth: '100%' },
  actionText: { ...font.medium, fontSize: size.secondary, color: colors.tx2, flexShrink: 1 },
  source: { gap: 5, padding: 10, backgroundColor: overlay.fill, borderRadius: 8 },
  path: { ...font.mono, fontSize: size.small, lineHeight: Math.round(size.small * 1.6), color: colors.tx3, ...(Platform.OS === 'web' ? { wordBreak: 'break-all' as const } : {}) },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 6, borderRadius: 5 },
  fold: { borderRadius: 8, borderWidth: 1, borderColor: overlay.hair, overflow: 'hidden' },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, minHeight: 40 },
  history: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  change: { gap: 3 },
  references: { gap: 2 },
  readerTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderTopWidth: 1, borderTopColor: overlay.hair, paddingTop: 12 },
  fileTitle: { ...font.mono, fontSize: size.secondary, color: colors.tx2, flexShrink: 1 },
  raw: { ...font.mono, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.65), color: colors.tx, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}) },
  markdown: { gap: 4, minWidth: 0 },
  body: { ...font.regular, fontSize: size.body, lineHeight: Math.round(size.body * 1.65), color: colors.tx, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}) },
  markdownHeading: { ...font.semibold, fontSize: size.title, marginTop: 12 },
  paragraphGap: { height: 7 },
  quote: { color: colors.tx2, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 10 },
  code: { ...font.mono, fontSize: size.small, lineHeight: Math.round(size.small * 1.65), color: colors.tx2, backgroundColor: overlay.fill, padding: 10, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}) },
  inlineCode: { ...font.mono, backgroundColor: overlay.fill },
  link: { color: colors.brand, textDecorationLine: 'underline' },
})
