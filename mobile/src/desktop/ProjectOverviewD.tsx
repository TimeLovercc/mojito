import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { ProjectOverview } from '../api/types'
import { RichText } from '../components/RichText'
import { t, tc } from '../i18n'
import { killState } from '../labels'
import { OVERVIEW_LABELS, openPath, overviewSource, paperNoteOnly, paperPills, scoreText } from '../overview'
import { colors, font, overlay, size } from '../theme'
import { useErrorToast } from '../toast'
import { hoverRow } from '../web-data'
import { dt } from './tokens'
import { BtnD, Pill, pillOf, Section } from './ui'

// 电脑项目详情的概况（design.md 8.11、api.md"项目概况"补充）：一张卡，左列小字段名、右列正文，依次
// 一句话 → 状态 → 生死实验 → 论文 → 摘要 → 查新 → 意义与下一步 → 审稿质疑（编号）→ 决定，每个项目都显示；
// 字段为 null 写"没有"，overview 整个为 null 都写"还没有"；文字按 Markdown 渲染链接。卡下一行来源小字
// （项目会话更新于 + 琥珀改动胶囊 / Claude 整理 / 你改的）。分数徽章在标题右侧（ScoreBadgeD）。
// 论文的 PDF / 评审 / 文件夹用系统默认程序打开（desktop 外壳的 open_path）
export function OverviewD({ overview: o }: { overview: ProjectOverview | null }) {
  const none = <Text style={styles.none}>{o === null ? t('还没有') : t('没有')}</Text>
  const md = (v: string | null) => (v === null ? none : <RichText text={v} style={styles.text} enums={false} />)
  const source = o === null ? null : overviewSource(o)
  return (
    <View style={styles.wrap}>
      <Section title={null} right={null} empty={false}>
        <Block label={OVERVIEW_LABELS.one_liner}>
          {o === null || o.one_liner === null ? none : <Text style={styles.lead}>{o.one_liner}</Text>}
        </Block>
        <Block label={OVERVIEW_LABELS.status}>{md(o === null ? null : o.status)}</Block>
        <Block label={OVERVIEW_LABELS.kill}>{o === null || o.kill === null ? none : <Kill kill={o.kill} />}</Block>
        <Block label={OVERVIEW_LABELS.paper}>{o === null || o.paper === null ? none : <Paper paper={o.paper} />}</Block>
        <Block label={OVERVIEW_LABELS.abstract}>{md(o === null ? null : o.abstract)}</Block>
        <Block label={OVERVIEW_LABELS.novelty}>{md(o === null ? null : o.novelty)}</Block>
        <Block label={OVERVIEW_LABELS.significance}>{md(o === null ? null : o.significance)}</Block>
        <Block label={OVERVIEW_LABELS.objections}>
          {o === null || o.objections === null || o.objections.length === 0 ? none : <Objections list={o.objections} />}
        </Block>
        <Block label={OVERVIEW_LABELS.decision}>{md(o === null ? null : o.decision)}</Block>
      </Section>
      {source === null ? null : (
        <View style={styles.source}>
          <Text style={styles.meta}>{source.text}</Text>
          {source.changed === null ? null : <Pill label={source.changed} tone="warn" />}
        </View>
      )}
    </View>
  )
}

// 标题右侧的分数徽章：高 28、圆角 8、15/600；score 为 null 不显示
export function ScoreBadgeD({ overview: o }: { overview: ProjectOverview | null }) {
  if (o === null || o.score === null) return null
  return (
    <View style={styles.score}>
      <Text style={styles.scoreText}>{scoreText(o.score)}</Text>
    </View>
  )
}

// 审稿质疑：编号列表，序号 mono tx3
function Objections({ list }: { list: string[] }) {
  return (
    <View style={styles.stack}>
      {list.map((x, i) => (
        <View key={i} style={styles.li}>
          <Text style={styles.num}>{i + 1}.</Text>
          <View style={styles.content}>
            <RichText text={x} style={styles.text} enums={false} />
          </View>
        </View>
      ))}
    </View>
  )
}

// 一行：左 96 标签列（12 tx3，英文长的折行），右边内容
function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.content}>{children}</View>
    </View>
  )
}

// 生死实验：状态胶囊；"设置"默认折叠，"进展"直接显示
function Kill({ kill }: { kill: NonNullable<ProjectOverview['kill']> }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={styles.stack}>
      <View style={styles.pills}>
        <Pill label={killState[kill.state].label} tone={pillOf[killState[kill.state].tone]} />
      </View>
      {kill.progress === '' ? null : (
        <View>
          <Text style={styles.sub}>{t('进展')}</Text>
          <RichText text={kill.progress} style={styles.text} enums={false} />
        </View>
      )}
      {kill.setting === '' ? null : (
        <View>
          <Pressable style={styles.toggle} onPress={() => setOpen(!open)} {...hoverRow}>
            <Text style={styles.sub}>{tc('生死实验', '设置')}</Text>
            <Chevron size={13} color={colors.tx3} />
          </Pressable>
          {open ? <RichText text={kill.setting} style={styles.text} enums={false} /> : null}
        </View>
      )}
    </View>
  )
}

function Paper({ paper: p }: { paper: NonNullable<ProjectOverview['paper']> }) {
  const showError = useErrorToast()
  if (paperNoteOnly(p)) return p.note === null ? <Text style={styles.none}>{t('没有')}</Text> : <RichText text={p.note} style={styles.text} enums={false} />
  const pills = paperPills(p)
  const links: [string, string | null][] = [
    [t('PDF'), p.pdf_path],
    [t('评审'), p.review_path],
    [t('文件夹'), p.dir_path],
  ]
  const open = (path: string) => openPath(path).catch((err: Error) => showError(t('打不开 {path}', { path }), err))
  return (
    <View style={styles.stack}>
      {p.title === null ? null : <Text style={styles.lead}>{p.title}</Text>}
      {pills.length === 0 ? null : (
        <View style={styles.pills}>
          {pills.map((x) => (
            <Pill key={x} label={x} tone="neutral" />
          ))}
        </View>
      )}
      {p.note === null ? null : <RichText text={p.note} style={styles.meta} enums={false} />}
      {links.every(([, path]) => path === null) ? null : (
        <View style={styles.pills}>
          {links.map(([label, path]) =>
            path === null ? null : <BtnD key={label} label={label} kind="neutral" size="sm" disabled={false} onPress={() => open(path)} />,
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  block: { flexDirection: 'row', gap: 16, paddingVertical: dt.space.rowV + 2, paddingHorizontal: dt.space.rowH },
  label: { ...font.regular, width: 96, fontSize: size.small, lineHeight: dt.line.body, color: colors.tx3 },
  content: { flex: 1, minWidth: 0 },
  lead: { ...font.medium, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx, userSelect: 'text' },
  text: { ...font.regular, fontSize: size.body, lineHeight: dt.line.para, color: colors.tx, userSelect: 'text' },
  none: { ...font.regular, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx3 },
  sub: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  meta: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  stack: { gap: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 4, marginLeft: -4, borderRadius: dt.radius.btn },
  source: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  li: { flexDirection: 'row', gap: 8 },
  num: { ...font.mono, width: 18, fontSize: size.body, lineHeight: dt.line.para, color: colors.tx3 },
  score: { height: 28, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, backgroundColor: overlay.fill },
  scoreText: { ...font.semibold, fontSize: size.body, color: colors.tx },
})
