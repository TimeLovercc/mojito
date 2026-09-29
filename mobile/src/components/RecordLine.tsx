import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { HubRecord } from '../api/types'
import { recordKind, sourceName } from '../labels'
import { Evidence, RichText } from './RichText'
import { colors, font, size } from '../theme'
import { UndoButton } from './Undo'
import { Who } from './ui'
import { t } from '../i18n'

// 时间线一条：头像、标题、正文、"时间 · 来源"。interrupt 标红。
export function RecordLine({ record, linkItem, showDate }: { record: HubRecord; linkItem: boolean; showDate: (iso: string) => string }) {
  const router = useRouter()
  const itemId = record.item_id
  const agent = record.author === 'system' && record.kind === 'chat'
  const source = record.author === 'me' ? recordKind[record.kind] : sourceName(record.source)
  // 系统写的文字里的字段名、枚举值转中文；我写的不动
  const enums = record.author === 'system'
  const titleOnly = record.body !== '' && record.body.startsWith(record.title)
  const meta = [showDate(record.at), source]
  const body = (
    <View style={styles.fi}>
      <Who who={record.author === 'me' ? 'me' : agent ? 'ai' : 'sys'} />
      <View style={styles.bd}>
        {/* 对话记录的 title 是正文前 40 字，这时只显示正文 */}
        <RichText
          text={titleOnly ? record.body : record.title}
          style={[styles.title, record.tier === 'interrupt' && { color: colors.bad }]}
          enums={enums}
        />
        {record.body === '' || titleOnly ? null : <RichText text={record.body} style={styles.body} enums={enums} />}
        <View style={styles.mtRow}>
          <Text style={styles.mt}>
            {meta.join(' · ')}
            {record.evidence === null ? null : (
              <>
                {' · '}
                <Evidence evidence={record.evidence} style={styles.mt} />
              </>
            )}
          </Text>
          <UndoButton record={record} label={t('撤销')} />
        </View>
      </View>
    </View>
  )
  if (!linkItem || itemId === null) return body
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/items/[id]', params: { id: itemId } })}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fi: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  bd: { flex: 1, gap: 2 },
  title: { ...font.regular, fontSize: size.body, color: colors.tx },
  body: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  mtRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  mt: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 1 },
})
