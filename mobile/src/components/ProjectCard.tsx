import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Project } from '../api/types'
import { killState, projectStatus } from '../labels'
import { ago } from '../time'
import { colors, font, size } from '../theme'
import { Tag } from './ui'
import { t } from '../i18n'

// 项目列表里的一行：名称、生死实验状态、项目状态、Claude 写的一句话现状、进行中事项数和最近动静
export function ProjectRow({ project: p }: { project: Project }) {
  const router = useRouter()
  const meta = [
    t('{n} 件进行中', { n: p.open_items }),
    p.last_activity_at === null ? t('还没有动静') : t('最近动静 {ago}', { ago: ago(p.last_activity_at) }),
  ]
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/projects/[id]', params: { id: p.id } })}
    >
      <View style={styles.top}>
        <Text style={styles.title}>{p.title}</Text>
        <View style={styles.tags}>
          {p.overview === null || p.overview.kill === null ? null : <Tag {...killState[p.overview.kill.state]} />}
          {p.stale ? <Tag label={t('7 天没动静')} tone="r" /> : null}
          {p.status === 'active' ? null : <Tag {...projectStatus[p.status]} />}
        </View>
      </View>
      {p.summary === null ? null : (
        <Text style={styles.summary} numberOfLines={3}>
          {p.summary}
        </Text>
      )}
      <Text style={styles.meta}>{meta.join(' · ')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { paddingVertical: 11, paddingHorizontal: 13, gap: 4 },
  pressed: { backgroundColor: colors.raised },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { ...font.semibold, fontSize: size.title, color: colors.tx, flexShrink: 1 },
  tags: { flexDirection: 'row', gap: 6 },
  summary: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
