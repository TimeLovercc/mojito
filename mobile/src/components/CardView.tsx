import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ExternalLink, MessageCircle } from 'lucide-react-native'
import type { Card, Project } from '../api/types'
import { todayYmd, when, ymdOf } from '../time'
import { useErrorToast } from '../toast'
import { colors, font, size } from '../theme'
import { trackAction } from '../usage'
import { AuthImage } from './AuthImage'
import { Markdown, plainText, RichText } from './RichText'
import { Card as Box, Tag } from './ui'
import { t } from '../i18n'

export const kindLabel: Record<Card['kind'], string> = {
  brief: t('每日简报'),
  alert: t('新动态'),
  paper: t('论文'),
  idea: t('想法'),
  report: t('报告'),
  other: t('其他'),
  mail: t('邮件'),
  post: t('帖子'),
}

// origin：brief、watch:<实验室>、arxiv、hf-daily、author:<名>、session:<worktree 名>、gmail；其他来源原样显示
export function originLabel(origin: string): string {
  if (origin === 'brief') return 'mojito'
  if (origin.startsWith('watch:')) return origin.slice('watch:'.length)
  if (origin === 'arxiv') return 'arXiv'
  if (origin === 'hf-daily') return 'Hugging Face'
  if (origin.startsWith('author:')) return t('关注作者 {name}', { name: origin.slice('author:'.length) })
  if (origin.startsWith('session:')) return t('会话 {name}', { name: origin.slice('session:'.length) })
  if (origin === 'gmail') return 'Gmail'
  return origin
}

// 报告卡（design.md 8.10）：列表里摘要只显示 3 行要点，点开看 body 全文
export const isReport = (card: Card) => card.kind === 'brief' || card.kind === 'alert'

// 当天的每日简报排在最上面，其余照时间倒序
export function pinTodayBrief(cards: Card[]): Card[] {
  const today = todayYmd()
  const brief = cards.find((c) => c.kind === 'brief' && ymdOf(new Date(c.at)) === today)
  if (brief === undefined) return cards
  return [brief, ...cards.filter((c) => c.id !== brief.id)]
}

// 信息流的一张卡片：只有"原文""问问"两个动作（design.md 8.3）；full=true 时（卡片详情）摘要不截断，报告显示 body 全文
export function CardView({ card, project, full }: { card: Card; project: Project | null; full: boolean }) {
  const router = useRouter()
  const showError = useErrorToast()
  const ask = () => {
    trackAction('card_ask', null)
    router.push({ pathname: '/chat', params: { card_id: card.id } })
  }
  const openLink = (link: string) => Linking.openURL(link).catch((err: Error) => showError(t('打不开链接'), err))
  const link = card.link

  return (
    <Box style={styles.card} onPress={full ? undefined : () => router.push({ pathname: '/cards/[id]', params: { id: card.id } })}>
      <View style={styles.metaRow}>
        {card.kind === 'alert' ? <Tag label={t('新动态')} tone="b" /> : null}
        <Text style={styles.meta}>
          {card.kind === 'alert' ? originLabel(card.origin) : `${kindLabel[card.kind]} · ${originLabel(card.origin)}`} · {when(card.at)}
        </Text>
      </View>
      {card.image_attachment_id === null ? (
        <>
          <Text style={[styles.title, full && isReport(card) && styles.titleBig]}>{card.title}</Text>
          {/* 每日邮件一封一行，行数就是封数，列表里也不截断；报告只显示 3 行要点 */}
          {/* 详情按 Markdown 显示（报告显示 body 全文）；列表里是去掉标记的纯文本（design.md 8.7） */}
          {full && card.body !== null ? (
            <Markdown text={card.body} style={styles.body} />
          ) : full ? (
            <Markdown text={card.summary} style={styles.summary} />
          ) : (
            <RichText
              text={plainText(card.summary)}
              style={styles.summary}
              enums={false}
              numberOfLines={card.kind === 'mail' ? undefined : isReport(card) ? 3 : 5}
            />
          )}
        </>
      ) : (
        // 帖子：封面缩略图 + 标题 + "作者 · 赞 N —— 为什么推给你"
        <View style={styles.post}>
          <AuthImage id={card.image_attachment_id} style={full ? styles.coverBig : styles.cover} contain={false} />
          <View style={styles.postText}>
            <Text style={styles.title}>{card.title}</Text>
            {full ? (
              <Markdown text={card.summary} style={styles.summary} />
            ) : (
              <RichText text={plainText(card.summary)} style={styles.summary} enums={false} numberOfLines={4} />
            )}
          </View>
        </View>
      )}
      {project === null ? null : (
        <View style={styles.project}>
          <Text style={styles.projectText}>{project.title}</Text>
        </View>
      )}
      <View style={styles.actions}>
        {link === null ? null : <Tool icon={ExternalLink} label={t('原文')} onPress={() => openLink(link)} />}
        <Tool icon={MessageCircle} label={t('问问')} onPress={ask} />
      </View>
    </Box>
  )
}

function Tool({ icon: Icon, label, onPress }: { icon: typeof ExternalLink; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.tool, pressed && { opacity: 0.5 }]}>
      <Icon size={14} color={colors.tx2} />
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, paddingHorizontal: 13, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2, flexShrink: 1 },
  title: { ...font.semibold, fontSize: size.title, color: colors.tx },
  titleBig: { fontSize: size.page, lineHeight: Math.round(size.page * 1.3) },
  // 报告全文：正文字号、主文字色，行距放宽（design.md 8.10）
  body: { ...font.regular, fontSize: size.body, lineHeight: Math.round(size.body * 1.6), color: colors.tx, userSelect: 'text' },
  summary: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  post: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  postText: { flex: 1, gap: 6 },
  cover: { width: 84, height: 112, borderRadius: 8, backgroundColor: colors.raised },
  coverBig: { width: 150, height: 200, borderRadius: 10, backgroundColor: colors.raised },
  project: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  projectText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
})
