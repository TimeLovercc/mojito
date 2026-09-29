import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { colors, font, overlay, size } from '../theme'
import { dragRegion } from '../web-data'
import { dt } from './tokens'

// 顶栏 v2（docs/desktop-v2.md 外壳·顶栏）：高 52，和红黄绿同一行；整条是 Mac 窗口拖动区（按钮自动排除）。
// 左边标题 16/600 + 副标题 13 tx2，只有真正的详情页才有"‹ 上级"；右边页面级的 28 工具按钮。
// 平时透明没有底线，内容滚到下面才出现 hair 线（滚动状态由页面用 useScrolled 提上来）。
// column：内容列宽（阅读页 720 居中）时，标题和内容列左缘对齐；null 时按内容区左右 32 对齐
export function TopBarD({
  title,
  sub,
  back,
  tools,
  column,
  scrolled,
}: {
  title: string
  // 副标题：一般是 13 tx2 的字；对话页放状态点 + 字，传节点
  sub: ReactNode | null
  back: { label: string; onPress: () => void } | null
  tools: ReactNode
  column: number | null
  scrolled: boolean
}) {
  return (
    <View style={[styles.bar, scrolled && styles.line]} {...dragRegion}>
      <View style={[styles.inner, column !== null && { maxWidth: column + dt.space.pageX * 2 }]}>
        <View style={styles.left}>
          {back === null ? null : (
            <Pressable onPress={back.onPress} style={styles.back} hitSlop={6}>
              <ChevronLeft size={16} color={colors.tx2} strokeWidth={1.8} />
              <Text style={styles.backText}>{back.label}</Text>
            </Pressable>
          )}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {sub === null ? null : typeof sub === 'string' ? (
            <Text style={styles.sub} numberOfLines={1}>
              {sub}
            </Text>
          ) : (
            sub
          )}
        </View>
        <View style={styles.tools}>{tools}</View>
      </View>
    </View>
  )
}

// 滚动区挂 onScroll，得到"是否已经滚离顶部"，给 TopBarD 的 scrolled
export function useScrolled(): [boolean, (e: NativeSyntheticEvent<NativeScrollEvent>) => void] {
  const [scrolled, setScrolled] = useState(false)
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => setScrolled(e.nativeEvent.contentOffset.y > 2), [])
  return [scrolled, onScroll]
}

const styles = StyleSheet.create({
  bar: { height: dt.height.bar, borderBottomWidth: 1, borderBottomColor: 'transparent', justifyContent: 'center' },
  line: { borderBottomColor: overlay.hair },
  inner: { flexDirection: 'row', alignItems: 'center', width: '100%', alignSelf: 'center', paddingHorizontal: dt.space.pageX, gap: 12 },
  left: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 10, minWidth: 0 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'center' },
  backText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  title: { ...font.semibold, fontSize: size.title, color: colors.tx },
  sub: { ...font.regular, fontSize: size.secondary, color: colors.tx2, flexShrink: 1 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
