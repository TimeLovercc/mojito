import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Goal, Item } from '../api/types'
import { category, itemStatus } from '../labels'
import { when } from '../time'
import { colors, font, size } from '../theme'
import { Dot, Tag } from './ui'
import { hoverRow } from '../web-data'
import { t } from '../i18n'

// 卡片里的一行事项：方框、标题、分类点 + 目标 + 时间、状态
export function ItemRow({ item, goals, showStatus }: { item: Item; goals: Goal[] | null; showStatus: boolean }) {
  const router = useRouter()
  const goal = item.goal_id === null || goals === null ? undefined : goals.find((g) => g.id === item.goal_id)
  const meta = [
    goal === undefined ? category[item.category].label : `${category[item.category].label} · ${goal.title}`,
    item.next_at === null ? t('没有时间') : when(item.next_at),
  ]
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      {...hoverRow}
    >
      <View style={[styles.ck, item.status === 'done' && styles.ckDone]} />
      <View style={styles.main}>
        <Text style={styles.title}>{item.title}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaText} numberOfLines={1}>
            {meta.join(' · ')}
          </Text>
        </View>
      </View>
      {item.forgotten ? <Tag label={t('被忘了')} tone="r" /> : showStatus ? <Tag {...itemStatus[item.status]} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 9, paddingHorizontal: 13 },
  pressed: { backgroundColor: colors.raised },
  ck: { width: 17, height: 17, borderRadius: 5, borderWidth: 1.5, borderColor: colors.line, marginTop: 1 },
  ckDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  main: { flex: 1, gap: 1 },
  title: { ...font.medium, fontSize: size.title, color: colors.tx },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...font.regular, fontSize: size.small, color: colors.tx2, flexShrink: 1 },
})
