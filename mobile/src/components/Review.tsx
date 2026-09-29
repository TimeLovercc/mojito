import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { actions } from '../api/client'
import type { Item, Review } from '../api/types'
import { useConfig } from '../config/context'
import { useRefresh } from '../refresh'
import { useErrorToast, useToast } from '../toast'
import { trackAction } from '../usage'
import { colors, font, radii, size } from '../theme'
import { Btn, Card, Section } from './ui'
import { t } from '../i18n'

function titleOf(items: Item[], id: string): string {
  const item = items.find((i) => i.id === id)
  return item === undefined ? id : item.title
}

// 一期的复盘：完成 / 没完成（脚本按事项状态算）、规律、总结；草稿时写"你的话"后完成复盘
export function ReviewCard({ review, items }: { review: Review; items: Item[] }) {
  return (
    <Section
      title={review.status === 'draft' ? t('复盘草稿') : t('复盘')}
      right={t('完成 {done} / {total}', { done: review.completed_item_ids.length, total: review.completed_item_ids.length + review.missed_item_ids.length })}
    >
      <Card style={styles.card}>
        {review.completed_item_ids.map((id) => (
          <View key={id} style={styles.line}>
            <Check size={14} color={colors.ok} />
            <Text style={styles.done}>{titleOf(items, id)}</Text>
          </View>
        ))}
        {review.missed_item_ids.map((id) => (
          <View key={id} style={styles.line}>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.missed}>{t('{title}（没完成）', { title: titleOf(items, id) })}</Text>
          </View>
        ))}
        <Text style={styles.summary}>{review.summary}</Text>
        {review.patterns.length === 0 ? null : <Patterns patterns={review.patterns} />}
        {review.status === 'done' ? (
          review.user_note === null || review.user_note === '' ? null : (
            <Text style={styles.note}>
              {t('你当时写的：')}
              {'\n'}“{review.user_note}”
            </Text>
          )
        ) : (
          <FinishForm planId={review.plan_id} />
        )}
      </Card>
    </Section>
  )
}

export function Patterns({ patterns }: { patterns: string[] }) {
  return (
    <View style={styles.insight}>
      {patterns.map((p) => (
        <Text key={p} style={styles.insightText}>
          <Text style={styles.insightLabel}>{t('规律：')}</Text>
          {p}
        </Text>
      ))}
    </View>
  )
}

function FinishForm({ planId }: { planId: string }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const finish = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.finishReview(config.hub, planId, note.trim())
      trackAction('review_finish', { with_note: note.trim() !== '' })
      toast(t('复盘完成，可以批准下一期计划了'), false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没提交上'), err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.form}>
      <Text style={styles.label}>{t('你的话（这两周怎么样、卡在哪；可以留空）')}</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={t('写几句…')}
        placeholderTextColor={colors.tx2}
        textAlignVertical="top"
      />
      <View style={{ flexDirection: 'row' }}>
        <Btn label={t('完成复盘')} primary disabled={busy} onPress={finish} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { paddingVertical: 11, paddingHorizontal: 13, gap: 7 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  done: { ...font.regular, fontSize: size.secondary, color: colors.tx, flex: 1 },
  dot: { ...font.regular, width: 14, textAlign: 'center', color: colors.tx2 },
  missed: { ...font.regular, fontSize: size.secondary, color: colors.tx2, flex: 1 },
  summary: {
    ...font.regular,
    fontSize: size.secondary,

    color: colors.tx2,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  note: {
    ...font.regular,
    fontSize: size.secondary,

    color: colors.tx2,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  insight: { gap: 4, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: colors.brand },
  insightText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  insightLabel: { ...font.semibold, color: colors.tx },
  form: { gap: 7, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  label: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  input: {
    ...font.regular,
    minHeight: 80,
    backgroundColor: colors.raised,
    color: colors.tx,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: size.body,
  },
})
