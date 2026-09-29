import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import type { Progress } from '../api/types'
import { colors, font, size } from '../theme'
import { t } from '../i18n'

// 进度来自 Item.progress（hub 按证据算），下面一行写明怎么算
export function ProgressBar({ progress, color }: { progress: Progress; color: string }) {
  const ratio = Math.min(1, progress.value / progress.target)
  const width = useSharedValue(0)
  useEffect(() => {
    width.value = withTiming(ratio, { duration: 600 })
  }, [ratio, width])
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }))
  return (
    <View style={styles.wrap}>
      <View style={styles.prog}>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { backgroundColor: color }, fill]} />
        </View>
        <Text style={styles.value}>{Math.round(ratio * 100)}%</Text>
      </View>
      <Text style={styles.evid}>
        {t('按 {unit} 计：{value} / {target}', { unit: progress.unit, value: progress.value.toLocaleString(), target: progress.target.toLocaleString() })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  prog: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  value: { ...font.mono, fontSize: size.small, color: colors.tx2, width: 36, textAlign: 'right' },
  evid: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
