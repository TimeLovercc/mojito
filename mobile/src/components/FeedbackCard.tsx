import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Feedback } from '../api/types'
import { feedbackStatus, screenName } from '../labels'
import { when } from '../time'
import { colors, font, size } from '../theme'
import { AuthImage } from './AuthImage'
import { FeedbackDecision } from './Decision'
import { RichText } from './RichText'
import { Card, Consequences, Tag } from './ui'
import { t } from '../i18n'

// 一条反馈：原话、截图、维护会话的说明；等你确认时带"同意上线 / 不要"
// link=true：点开看这条反馈的讨论
export function FeedbackCard({ fb, link }: { fb: Feedback; link: boolean }) {
  const router = useRouter()
  return (
    <Card
      style={[styles.card, fb.status === 'awaiting_approval' && styles.ask]}
      onPress={link ? () => router.push({ pathname: '/feedback/[id]', params: { id: fb.id } }) : undefined}
    >
      <View style={styles.head}>
        <Text style={styles.meta}>
          {when(fb.at)}
          {fb.context.screen === null ? '' : ` · ${t('在{screen}页', { screen: screenName(fb.context.screen) })}`}
        </Text>
        <Tag {...feedbackStatus[fb.status]} />
      </View>
      <Text style={styles.body}>{fb.body === '' ? t('（只有截图）') : fb.body}</Text>
      {fb.attachments.length === 0 ? null : (
        <View style={styles.thumbs}>
          {fb.attachments.map((a) => (
            <AuthImage key={a.id} id={a.id} style={styles.thumb} contain={false} />
          ))}
        </View>
      )}
      {fb.summary === null ? null : (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>{t('维护会话：')}</Text>
          <RichText text={fb.summary} style={styles.summaryText} enums={false} />
        </View>
      )}
      {fb.status === 'awaiting_approval' ? <Consequences lines={[t('同意上线：维护会话把这个修复发给你'), t('不要：放弃这个改动')]} /> : null}
      {fb.status === 'awaiting_approval' ? <FeedbackDecision fb={fb} /> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingVertical: 11, paddingHorizontal: 13, gap: 6 },
  ask: { borderLeftWidth: 3, borderLeftColor: colors.warn },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  body: { ...font.regular, fontSize: size.body, color: colors.tx },
  thumbs: { flexDirection: 'row', gap: 6 },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  summary: { gap: 2, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.line },
  summaryLabel: { ...font.semibold, fontSize: size.small, color: colors.tx2 },
  summaryText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
})
