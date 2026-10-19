import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { PageMeta } from '../api/types'
import { useOpenPage } from '../pages'
import { colors, font, size } from '../theme'
import { when } from '../time'
import { hoverRow } from '../web-data'

// 页面列表的一行（页面页、项目详情的"相关页面"共用）：标题 + 本地短时间，下面摘要；点开见 useOpenPage
export function PageRow({ page }: { page: PageMeta }) {
  const open = useOpenPage()
  return (
    <Pressable onPress={() => open(page.path)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} {...hoverRow}>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {page.title}
          </Text>
          <Text style={styles.time}>{when(page.updated_at)}</Text>
        </View>
        <Text style={styles.summary} numberOfLines={2}>
          {page.summary}
        </Text>
      </View>
      <ChevronRight size={15} color={colors.tx3} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 14 },
  pressed: { opacity: 0.7 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { ...font.medium, flex: 1, fontSize: size.body, color: colors.tx },
  time: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  summary: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.5), color: colors.tx2 },
})
