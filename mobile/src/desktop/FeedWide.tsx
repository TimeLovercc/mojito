import { Fragment, useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { actions, hubRequest } from '../api/client'
import type { Card, CardsPage, Project, ProjectsList } from '../api/types'
import { AuthImage } from '../components/AuthImage'
import { isReport, kindLabel, originLabel, pinTodayBrief } from '../components/CardView'
import { Markdown, plainText } from '../components/RichText'
import { StaleBanner } from '../components/Screen'
import { useConfig } from '../config/context'
import { useMarkReadOnLeave } from '../read-mark'
import { addDays, clock, longDate, todayYmd, weekdayOf, ymdOf } from '../time'
import { t } from '../i18n'
import { useErrorToast } from '../toast'
import { colors, font, overlay, size } from '../theme'
import { trackAction, useViewTracking } from '../usage'
import { useHub } from '../use-hub'
import { hoverRow } from '../web-data'
import { useChatSubject } from '../wide'
import { Menu } from './Menu'
import { TopBarD } from './TopBar'
import { dt } from './tokens'
import { BtnD, Pill } from './ui'

const PAGE = 20

// 电脑信息流（docs/desktop-v2.md 逐页方案 4、内部界面稿（未公开） 第 3 节）：左列表 360（内容区窄于 900 时 320），
// 按本地日期分组、组头吸顶（不写条数）；行 = 来源·类型 / 标题 / 摘要纯文本 / 项目胶囊 / 40 缩略图；
// "上次读到这里"是两侧 hair 的分隔。右阅读区：kicker、24/32 标题、"原文 ↗"和"问问"、封面最高 240、Markdown 16/26
export function FeedWide() {
  const router = useRouter()
  const { config } = useConfig()
  const showError = useErrorToast()
  const view = useHub<CardsPage>(`/cards?limit=${PAGE}`)
  const projects = useHub<ProjectsList>('/projects')
  const [older, setOlder] = useState<Card[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  useViewTracking('feed')

  const page = view.data
  useEffect(() => {
    setOlder([])
    setExhausted(page !== null && page.cards.length < PAGE)
  }, [page])
  // 离开信息流时把看到的最新一张记为已读
  const newest = page !== null && page.cards.length > 0 ? page.cards[0].id : null
  useMarkReadOnLeave(newest, page === null ? null : page.last_read_id, view.live, actions.markCardRead)

  const all = page === null ? [] : [...page.cards, ...older]
  const cut = page === null || page.last_read_id === null ? -1 : all.findIndex((c) => c.id === page.last_read_id)
  const freshCount = page === null ? null : cut === -1 ? all.length : cut
  // 当天的每日简报排在最上面（design.md 8.10）；"上次读到这里"仍按原顺序算哪些是新的，画在置顶那张之后第一张看过的卡片前
  const ordered = pinTodayBrief(all)
  const pinned = ordered.length > 0 && ordered[0] !== all[0]
  const freshIds = new Set((cut === -1 ? all : all.slice(0, cut)).map((c) => c.id))
  const markAt = cut === -1 ? -1 : ordered.findIndex((c, i) => !(pinned && i === 0) && !freshIds.has(c.id))
  const selected = picked !== null && all.some((c) => c.id === picked) ? picked : ordered.length === 0 ? null : ordered[0].id
  const shown = all.find((c) => c.id === selected)
  const projectOf = (id: string | null): Project | null => {
    if (id === null || projects.data === null) return null
    const found = projects.data.projects.find((p) => p.id === id)
    return found === undefined ? null : found
  }

  const loadOlder = async () => {
    if (config.hub === null) throw new Error('没有 hub 配置')
    try {
      const next = await hubRequest<CardsPage>(
        config.hub,
        'GET',
        `/cards?limit=${PAGE}&before=${encodeURIComponent(all[all.length - 1].id)}`,
      )
      setOlder((prev) => [...prev, ...next.cards])
      if (next.cards.length < PAGE) setExhausted(true)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('加载失败'), err)
    }
  }

  return (
    <View style={styles.page} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <TopBarD
        title={t('信息流')}
        sub={freshCount === null || freshCount === 0 ? null : t('{n} 条新的', { n: freshCount })}
        back={null}
        tools={
          <>
            <BtnD label={t('订阅')} kind="neutral" size="md" disabled={false} onPress={() => router.push('/subscriptions')} />
            {/* 口味靠对话（8.3），收进"⋯" */}
            <Menu label={t('更多')} items={[{ label: t('口味'), danger: false, onPress: () => router.push('/taste') }]} />
          </>
        }
        column={null}
        scrolled={false}
      />
      <View style={styles.split}>
        <ScrollView
          style={[styles.list, { width: width !== 0 && width < 900 ? 320 : dt.width.feedList }]}
          contentContainerStyle={styles.listBody}
        >
          <StaleBanner view={view} />
          {page !== null && all.length === 0 ? <Text style={styles.none}>{t('还没有卡片')}</Text> : null}
          {ordered.map((c, i) => {
            const day = ymdOf(new Date(c.at))
            const newDay = i === 0 || ymdOf(new Date(ordered[i - 1].at)) !== day
            const prevSelected = i > 0 && ordered[i - 1].id === selected
            return (
              <Fragment key={c.id}>
                {i === markAt ? <ReadMark /> : null}
                {newDay ? <Text style={styles.groupHead}>{dayLabel(day)}</Text> : null}
                <Row
                  card={c}
                  project={projectOf(c.project_id)}
                  selected={c.id === selected}
                  // 行间 hair 分隔：组的第一行、选中行和它下面一行不画
                  line={!newDay && !(i === markAt) && c.id !== selected && !prevSelected}
                  onPress={() => setPicked(c.id)}
                />
              </Fragment>
            )
          })}
          {page === null || all.length === 0 ? null : exhausted ? (
            <Text style={styles.end}>{t('没有更早的了')}</Text>
          ) : (
            <View style={styles.more}>
              <BtnD label={t('再往前')} kind="ghost" size="sm" disabled={false} onPress={loadOlder} />
            </View>
          )}
        </ScrollView>
        <View style={styles.reader}>{shown === undefined ? null : <Reader key={shown.id} card={shown} />}</View>
      </View>
    </View>
  )
}

// 组头：今天 / 昨天 / 9月26日 周六
function dayLabel(ymd: string): string {
  const today = todayYmd()
  if (ymd === today) return t('今天')
  if (ymd === addDays(today, -1)) return t('昨天')
  return `${longDate(ymd)} ${weekdayOf(ymd)}`
}

function ReadMark() {
  return (
    <View style={styles.readmark}>
      <View style={styles.readLine} />
      <Text style={styles.readText}>{t('上次读到这里')}</Text>
      <View style={styles.readLine} />
    </View>
  )
}

function Row({
  card,
  project,
  selected,
  line,
  onPress,
}: {
  card: Card
  project: Project | null
  selected: boolean
  line: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && styles.rowOn]} {...hoverRow}>
      {line ? <View style={styles.rowLine} /> : null}
      <View style={styles.rowMain}>
        {card.kind === 'alert' ? (
          <View style={styles.srcRow}>
            <Pill label={t('新动态')} tone="brand" />
            <Text style={styles.src}>{originLabel(card.origin)}</Text>
          </View>
        ) : (
          <Text style={styles.src}>
            {originLabel(card.origin)} · {kindLabel[card.kind]}
          </Text>
        )}
        <Text style={styles.rowTitle} numberOfLines={2}>
          {card.title}
        </Text>
        {/* 报告卡是 3 行要点，全部显示；其余 2 行 */}
        <Text style={styles.sum} numberOfLines={isReport(card) ? 3 : 2}>
          {plainText(card.summary)}
        </Text>
        {project === null ? null : (
          <View style={styles.pill}>
            <Pill label={project.title} tone="neutral" />
          </View>
        )}
      </View>
      {card.image_attachment_id === null ? null : <AuthImage id={card.image_attachment_id} style={styles.thumb} contain={false} />}
    </Pressable>
  )
}

// 阅读区（最宽 680）：登记为对话的"正在看"
function Reader({ card }: { card: Card }) {
  const router = useRouter()
  const showError = useErrorToast()
  useChatSubject({ kind: 'card', id: card.id, title: card.title })
  const link = card.link
  return (
    <ScrollView contentContainerStyle={styles.readerBody}>
      <View style={styles.rd}>
        <Text style={styles.kick}>
          {originLabel(card.origin)} · {kindLabel[card.kind]} · <Text style={font.mono}>{clock(card.at)}</Text>
        </Text>
        <Text style={styles.readerTitle}>{card.title}</Text>
        <View style={styles.acts}>
          {link === null ? null : (
            <BtnD
              label={t('原文 ↗')}
              kind="primary"
              size="sm"
              disabled={false}
              onPress={() => Linking.openURL(link).catch((err: Error) => showError(t('打不开链接'), err))}
            />
          )}
          <BtnD
            label={t('问问')}
            kind="neutral"
            size="sm"
            disabled={false}
            onPress={() => {
              trackAction('card_ask', null)
              router.push({ pathname: '/chat', params: { card_id: card.id } })
            }}
          />
        </View>
        {/* 封面最高 240、等比、左对齐、hair 环 */}
        {card.image_attachment_id === null ? null : (
          <View style={styles.cover}>
            <AuthImage id={card.image_attachment_id} style={styles.coverImg} contain />
          </View>
        )}
        {/* 报告显示 body 全文（design.md 8.10）；旧卡片和没写 body 的显示摘要 */}
        <View style={styles.md}>
          <Markdown text={card.body === null ? card.summary : card.body} style={styles.reading} />
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  split: { flex: 1, flexDirection: 'row' },
  list: { flexGrow: 0, borderRightWidth: 0.5, borderRightColor: overlay.hair },
  listBody: { paddingHorizontal: 16, paddingBottom: 16 },
  none: { ...font.regular, fontSize: size.body, color: colors.tx2, padding: 16 },
  groupHead: {
    ...font.medium,
    fontSize: size.small,
    lineHeight: dt.line.small,
    color: colors.tx3,
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: dt.radius.row },
  rowOn: { backgroundColor: overlay.selected },
  rowLine: { position: 'absolute', top: 0, left: 16, right: 16, height: 1, backgroundColor: overlay.rowLine },
  rowMain: { flex: 1, minWidth: 0 },
  src: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { ...font.medium, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx, marginTop: 2 },
  sum: { ...font.regular, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2, marginTop: 2 },
  pill: { flexDirection: 'row', marginTop: 6 },
  thumb: { width: 40, height: 40, borderRadius: 6, marginTop: 18, boxShadow: `0 0 0 0.5px ${overlay.hair}` },
  readmark: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 16 },
  readLine: { flex: 1, height: 1, backgroundColor: overlay.hair },
  readText: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  end: { ...font.regular, fontSize: size.small, color: colors.tx3, textAlign: 'center', marginTop: 12 },
  more: { alignItems: 'center', marginTop: 12 },
  reader: { flex: 1, minWidth: 0 },
  // 顶部 40：kicker 和列表第一行的来源同高（稿第 6 节）
  readerBody: { paddingTop: 40, paddingHorizontal: dt.space.pageX, paddingBottom: 24 },
  rd: { maxWidth: dt.width.aiText },
  kick: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  readerTitle: {
    ...font.semibold,
    fontSize: size.page,
    lineHeight: dt.line.page,
    color: colors.tx,
    marginTop: 6,
    marginBottom: 12,
    userSelect: 'text',
  },
  acts: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  cover: { marginTop: 20, alignItems: 'flex-start' },
  coverImg: { height: 240, width: 360, borderRadius: 8 },
  md: { marginTop: 20 },
  reading: { ...font.regular, fontSize: size.title, lineHeight: dt.line.reading, color: colors.tx, userSelect: 'text' },
})
