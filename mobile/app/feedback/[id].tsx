import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { Feedback, FeedbackMessages } from '../../src/api/types'
import { AuthImage } from '../../src/components/AuthImage'
import { Composer } from '../../src/components/Chat'
import { FeedbackCard } from '../../src/components/FeedbackCard'
import { Markdown } from '../../src/components/RichText'
import { Screen } from '../../src/components/Screen'
import { Empty, Section } from '../../src/components/ui'
import { when } from '../../src/time'
import { colors, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { t } from '../../src/i18n'

// 一条反馈的完整讨论：我和维护会话来回说，底部可以回复（POST /feedback/{id}/messages）
export default function FeedbackThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const view = useHub<Feedback>(`/feedback/${encodeURIComponent(id)}`)
  const messages = useHub<FeedbackMessages>(`/feedback/${encodeURIComponent(id)}/messages`)
  useViewTracking('feedback_sheet')
  return (
    <Screen
      view={view}
      head={{ kind: 'back', label: t('反馈与建议') }}
      bottom={<Composer target={{ kind: 'feedback_reply', feedbackId: id }} placeholder={t('回复维护会话…')} chips={null} />}
    >
      {(fb) => (
        <>
          <FeedbackCard fb={fb} link={false} />
          <Section title={t('讨论')} right={messages.data === null ? '' : String(messages.data.messages.length)}>
            {messages.data === null ? null : messages.data.messages.length === 0 ? (
              <Empty text={t('还没有讨论。维护会话有问题会在这里问你，也会推送到对话里')} />
            ) : (
              <View style={styles.msgs}>
                {messages.data.messages.map((m) => (
                  <View key={m.id} style={[styles.m, m.author === 'me' ? styles.me : styles.them]}>
                    {m.attachments.length === 0 ? null : (
                      <View style={styles.thumbs}>
                        {m.attachments.map((a) => (
                          <AuthImage key={a.id} id={a.id} style={styles.thumb} contain={false} />
                        ))}
                      </View>
                    )}
                    {m.body === '' ? null : <Markdown text={m.body} style={m.author === 'me' ? styles.meText : styles.themText} />}
                    <Text style={m.author === 'me' ? styles.meMeta : styles.themMeta}>
                      {when(m.at)}
                      {m.author === 'me' ? '' : ` · ${t('维护会话')}`}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Section>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  msgs: { gap: 10 },
  m: { maxWidth: '84%', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 16 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 5 },
  them: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 5 },
  meText: { ...font.regular, fontSize: size.body, color: colors.onBrand },
  themText: { ...font.regular, fontSize: size.body, color: colors.tx },
  meMeta: { ...font.regular, fontSize: size.small, color: colors.onBrand, opacity: 0.75, marginTop: 4 },
  themMeta: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 4 },
  thumbs: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  thumb: { width: 96, height: 96, borderRadius: 8 },
})
