import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { actions, hubRequest } from '../../src/api/client'
import type { Card, CardsPage, ProjectsList } from '../../src/api/types'
import { AuthImage } from '../../src/components/AuthImage'
import { CardView, kindLabel, originLabel } from '../../src/components/CardView'
import { Markdown, plainText } from '../../src/components/RichText'
import { Screen, TopBar } from '../../src/components/Screen'
import { Btn, Empty, Filter } from '../../src/components/ui'
import { useConfig } from '../../src/config/context'
import { useErrorToast, useToast } from '../../src/toast'
import { colors, desktop, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { trackAction, useViewTracking } from '../../src/usage'
import { useMarkReadOnLeave } from '../../src/read-mark'
import { when } from '../../src/time'
import { useChatSubject, useWide } from '../../src/wide'
import { hoverRow } from '../../src/web-data'
import { FeedWide } from '../../src/desktop/FeedWide'
import { t } from '../../src/i18n'

const PAGE = 20

// 信息流：值得读的东西（论文、会话发布的结果）。有尽头，"上次读到这里"以下是看过的。
// 电脑宽屏用 src/desktop/FeedWide.tsx；手机和非电脑密度的宽屏（iPad）用下面的页面
export default function CardsScreen() {
  const wide = useWide()
  return wide && desktop ? <FeedWide /> : <CardsList />
}

// 宽屏（design.md 8.4，iPad 等非电脑密度）：左边列表，右边阅读区
function CardsList() {
  const wide = useWide()
  const [picked, setPicked] = useState<string | null>(null)
  const view = useHub<CardsPage>(`/cards?limit=${PAGE}`)
  const projects = useHub<ProjectsList>('/projects')
  const router = useRouter()
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [older, setOlder] = useState<Card[]>([])
  const [exhausted, setExhausted] = useState(false)
  useViewTracking('feed')

  const page = view.data
  useEffect(() => {
    setOlder([])
    setExhausted(page !== null && page.cards.length < PAGE)
  }, [page])

  // 离开信息流时把看到的最新一张记为已读
  const newest = page !== null && page.cards.length > 0 ? page.cards[0].id : null
  useMarkReadOnLeave(newest, page === null ? null : page.last_read_id, view.live, actions.markCardRead)

  const loadOlder = async (all: Card[]) => {
    if (config.hub === null) throw new Error('没有 hub 配置')
    const last = all[all.length - 1]
    try {
      const next = await hubRequest<CardsPage>(config.hub, 'GET', `/cards?limit=${PAGE}&before=${encodeURIComponent(last.id)}`)
      setOlder((prev) => [...prev, ...next.cards])
      if (next.cards.length < PAGE) setExhausted(true)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('加载失败'), err)
    }
  }

  // 卡片挂的项目；没挂、项目列表还没到、或项目已不在 active/paused 列表里时不显示
  const projectOf = (id: string | null) => {
    if (id === null || projects.data === null) return null
    const found = projects.data.projects.find((p) => p.id === id)
    return found === undefined ? null : found
  }

  const filters = (
    <View style={styles.filt}>
      <View style={{ flex: 1 }} />
      <Filter label={t('订阅')} on={false} onPress={() => router.push('/subscriptions')} />
      <Filter label={t('口味')} on={false} onPress={() => router.push('/taste')} />
    </View>
  )

  // 宽屏阅读区显示的卡片：点过的，或最上面一张
  const selectedOf = (all: Card[]) => (picked !== null && all.some((c) => c.id === picked) ? picked : all.length === 0 ? null : all[0].id)
  const shown = (() => {
    if (page === null) return null
    const all = [...page.cards, ...older]
    const id = selectedOf(all)
    const found = all.find((c) => c.id === id)
    return found === undefined ? null : found
  })()

  const screen = (
    <Screen view={view} head={wide ? { kind: 'none' } : { kind: 'title', title: t('信息流') }} top={filters} fab full={wide} flush={wide}>
      {({ cards, last_read_id }) => {
        const all = [...cards, ...older]
        const cut = last_read_id === null ? -1 : all.findIndex((c) => c.id === last_read_id)
        const fresh = cut === -1 ? all : all.slice(0, cut)
        const read = cut === -1 ? [] : all.slice(cut)
        return (
          <View style={styles.list}>
            {fresh.length === 0 ? (
              <View style={styles.pad}>
                <Empty text={read.length === 0 ? t('还没有卡片') : t('没有新卡片，下面是看过的 {n} 张', { n: read.length })} />
              </View>
            ) : null}
            {fresh.map((c) =>
              wide ? (
                <CardRow key={c.id} card={c} selected={c.id === selectedOf(all)} onPress={() => setPicked(c.id)} />
              ) : (
                <CardView key={c.id} card={c} project={projectOf(c.project_id)} full={false} />
              ),
            )}
            {cut === -1 ? null : (
              <View style={styles.readmark}>
                <View style={styles.line} />
                <Text style={styles.readText}>{t('上次读到这里')}</Text>
                <View style={styles.line} />
              </View>
            )}
            {read.length === 0 ? null : (
              <View style={[styles.list, styles.old]}>
                {read.map((c) =>
                  wide ? (
                    <CardRow key={c.id} card={c} selected={c.id === selectedOf(all)} onPress={() => setPicked(c.id)} />
                  ) : (
                    <CardView key={c.id} card={c} project={projectOf(c.project_id)} full={false} />
                  ),
                )}
              </View>
            )}
            {exhausted ? (
              <Text style={styles.end}>{t('没有更早的了')}</Text>
            ) : (
              <View style={styles.more}>
                <Btn label={t('再往前')} onPress={() => loadOlder(all)} />
              </View>
            )}
          </View>
        )
      }}
    </Screen>
  )
  if (!wide) return screen
  // 宽屏照 内部界面稿（未公开）：顶栏横跨两栏，左边行列表，右边阅读区
  const freshCount =
    page === null ? null : page.last_read_id === null ? page.cards.length : page.cards.findIndex((c) => c.id === page.last_read_id)
  return (
    <View style={styles.page}>
      <TopBar
        head={{ kind: 'title', title: t('信息流') }}
        sub={freshCount === null || freshCount < 0 ? null : t('{n} 条新的', { n: freshCount })}
        tools={null}
        syncing={view.syncing && !view.pulling}
      />
      <View style={styles.split}>
        <View style={styles.listCol}>{screen}</View>
        <View style={styles.reader}>
          {shown === null ? (
            <View style={styles.pad}>
              <Empty text={t('选一张卡片来读')} />
            </View>
          ) : (
            <Reader key={shown.id} card={shown} project={projectOf(shown.project_id)} />
          )}
        </View>
      </View>
    </View>
  )
}

// 宽屏列表里的一行：标题、两行摘要、来源和时间；选中的高亮，内容在右边阅读区
function CardRow({ card, selected, onPress }: { card: Card; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && styles.rowOn]} {...hoverRow}>
      {card.image_attachment_id === null ? null : <AuthImage id={card.image_attachment_id} style={styles.thumb} contain={false} />}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{card.title}</Text>
        <Text style={styles.rowSum} numberOfLines={2}>
          {plainText(card.summary)}
        </Text>
        <Text style={styles.rowMeta}>
          {kindLabel[card.kind]} · {originLabel(card.origin)} · {when(card.at)}
        </Text>
      </View>
    </Pressable>
  )
}

// 宽屏阅读区（内部界面稿（未公开） 的 .reader）：来源 · 时间、大标题、封面、摘要、动作按钮；登记为对话面板的"正在看"
function Reader({ card, project }: { card: Card; project: ProjectsList['projects'][number] | null }) {
  useChatSubject({ kind: 'card', id: card.id, title: card.title })
  const router = useRouter()
  const showError = useErrorToast()
  const link = card.link
  return (
    <ScrollView contentContainerStyle={styles.readerBody}>
      <Text style={styles.kick}>
        {originLabel(card.origin)} · {kindLabel[card.kind]} · {when(card.at)}
      </Text>
      <Text style={styles.readerTitle}>{card.title}</Text>
      {card.image_attachment_id === null ? null : <AuthImage id={card.image_attachment_id} style={styles.cover} contain={false} />}
      <Markdown text={card.summary} style={styles.para} />
      {project === null ? null : <Text style={styles.kick}>{t('项目：{title}', { title: project.title })}</Text>}
      <View style={styles.acts}>
        {link === null ? null : (
          <Btn label={t('打开原文')} primary onPress={() => Linking.openURL(link).catch((err: Error) => showError(t('打不开链接'), err))} />
        )}
        <Btn
          label={t('问问这个')}
          onPress={() => {
            trackAction('card_ask', null)
            router.push({ pathname: '/chat', params: { card_id: card.id } })
          }}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  listCol: { width: 400, borderRightWidth: 1, borderRightColor: colors.line },
  reader: { flex: 1, minWidth: 0 },
  readerBody: { paddingHorizontal: 34, paddingVertical: 26, gap: 16 },
  kick: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  // 阅读区标题 24/32、正文 16/26（docs/desktop-v2.md 字号），正文可选中
  readerTitle: { ...font.semibold, fontSize: size.page, lineHeight: Math.round(size.page * 1.33), color: colors.tx, userSelect: 'text' },
  cover: { width: 180, height: 240, borderRadius: 10, backgroundColor: colors.raised },
  para: {
    ...font.regular,
    fontSize: size.title,
    lineHeight: Math.round(size.title * 1.625),
    color: colors.tx,
    maxWidth: 680,
    userSelect: 'text',
  },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  pad: { paddingHorizontal: 18, paddingVertical: 14 },
  more: { flexDirection: 'row', justifyContent: 'center', paddingTop: 12 },
  row: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowText: { flex: 1, gap: 5 },
  thumb: { width: 48, height: 64, borderRadius: 6, backgroundColor: colors.raised },
  rowOn: { backgroundColor: colors.brandSoft },
  rowTitle: { ...font.medium, fontSize: size.body, color: colors.tx },
  rowSum: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  rowMeta: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  filt: desktop
    ? { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line }
    : { flexDirection: 'row', gap: 6 },
  list: { gap: desktop ? 0 : 10 },
  readmark: desktop
    ? { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 10 }
    : { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: colors.brandSoft },
  readText: { ...font.regular, fontSize: size.small, color: colors.brand },
  old: { opacity: desktop ? 0.55 : 0.8 },
  end: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'center', marginTop: 8 },
})
