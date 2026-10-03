import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { ProjectOverview } from '../api/types'
import { t, tc } from '../i18n'
import { killState } from '../labels'
import { OVERVIEW_LABELS, overviewSource, paperNoteOnly, paperPills, scoreText } from '../overview'
import { colors, font, size } from '../theme'
import { RichText } from './RichText'
import { Card, Rows, Tag } from './ui'

// 手机项目详情的概况：一句话 → 状态 → 生死实验 → 论文 → 摘要 → 查新 → 意义与下一步 → 审稿质疑 → 决定，
// 每个项目都显示（design.md 8.11、api.md"项目概况"补充）。字段为 null 写"没有"，overview 整个为 null 都写"还没有"；
// 文字按 Markdown 渲染链接；底部一行来源小字。分数徽章在标题旁（ScoreBadge）；论文的本地文件链接只在 Mac 上有
export function OverviewCard({ overview: o }: { overview: ProjectOverview | null }) {
  const none = <Text style={styles.none}>{o === null ? t('还没有') : t('没有')}</Text>
  const md = (v: string | null) => (v === null ? none : <RichText text={v} style={styles.text} enums={false} />)
  const source = o === null ? null : overviewSource(o)
  return (
    <View style={styles.wrap}>
      <Card>
        <Rows>
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
        </Rows>
      </Card>
      {source === null ? null : (
        <View style={styles.source}>
          <Text style={styles.meta}>{source.text}</Text>
          {source.changed === null ? null : <Tag label={source.changed} tone="a" />}
        </View>
      )}
    </View>
  )
}

// 标题旁的分数徽章；score 为 null 不显示
export function ScoreBadge({ overview: o }: { overview: ProjectOverview | null }) {
  if (o === null || o.score === null) return null
  return (
    <View style={styles.score}>
      <Text style={styles.scoreText}>{scoreText(o.score)}</Text>
    </View>
  )
}

// 审稿质疑：编号列表
function Objections({ list }: { list: string[] }) {
  return (
    <View style={styles.list}>
      {list.map((x, i) => (
        <View key={i} style={styles.li}>
          <Text style={styles.num}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <RichText text={x} style={styles.text} enums={false} />
          </View>
        </View>
      ))}
    </View>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

// 生死实验：状态胶囊，"进展"直接显示，"设置"默认折叠（和 Mac 同序）
function Kill({ kill }: { kill: NonNullable<ProjectOverview['kill']> }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={styles.kill}>
      <View style={styles.tags}>
        <Tag {...killState[kill.state]} />
      </View>
      {kill.progress === '' ? null : (
        <>
          <Text style={styles.sub}>{t('进展')}</Text>
          <RichText text={kill.progress} style={styles.text} enums={false} />
        </>
      )}
      {kill.setting === '' ? null : (
        <>
          <Pressable style={styles.toggle} hitSlop={6} onPress={() => setOpen(!open)}>
            <Text style={styles.sub}>{tc('生死实验', '设置')}</Text>
            <Chevron size={14} color={colors.tx2} />
          </Pressable>
          {open ? <RichText text={kill.setting} style={styles.text} enums={false} /> : null}
        </>
      )}
    </View>
  )
}

function Paper({ paper: p }: { paper: NonNullable<ProjectOverview['paper']> }) {
  if (paperNoteOnly(p)) return p.note === null ? <Text style={styles.none}>{t('没有')}</Text> : <RichText text={p.note} style={styles.text} enums={false} />
  const pills = paperPills(p)
  return (
    <View style={styles.kill}>
      {p.title === null ? null : <Text style={styles.lead}>{p.title}</Text>}
      {pills.length === 0 ? null : (
        <View style={styles.tags}>
          {pills.map((x) => (
            <Tag key={x} label={x} tone="n" />
          ))}
        </View>
      )}
      {p.note === null ? null : <RichText text={p.note} style={styles.meta} enums={false} />}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  block: { paddingVertical: 10, paddingHorizontal: 13, gap: 4 },
  label: { ...font.medium, fontSize: size.small, color: colors.tx2 },
  lead: { ...font.medium, fontSize: size.body, color: colors.tx },
  text: { ...font.regular, fontSize: size.body, color: colors.tx },
  none: { ...font.regular, fontSize: size.body, color: colors.tx3 },
  sub: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  kill: { gap: 6, alignItems: 'flex-start' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  source: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 },
  list: { gap: 6 },
  li: { flexDirection: 'row', gap: 6 },
  num: { ...font.mono, fontSize: size.body, color: colors.tx2 },
  score: { backgroundColor: colors.raised, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  scoreText: { ...font.semibold, fontSize: size.secondary, color: colors.tx },
})
