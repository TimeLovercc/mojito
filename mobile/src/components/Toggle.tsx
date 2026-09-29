import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { colors, desktop, txAlpha } from '../theme'

// 开关：电脑密度下自绘（轨道 32×18、白色滑块 14；开是品牌色，关是文字色 15%，docs/desktop-v2.md 控件），
// 手机和浏览器窄屏仍用系统 Switch
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (next: boolean) => void; disabled: boolean }) {
  if (!desktop) {
    return (
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.raised, true: colors.brand }}
        thumbColor={colors.card}
      />
    )
  }
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.track, { backgroundColor: value ? colors.brand : txAlpha(0.15) }, disabled && { opacity: 0.5 }]}
    >
      <View style={[styles.thumb, value && styles.on]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: { width: 32, height: 18, borderRadius: 9, padding: 2, justifyContent: 'center' },
  thumb: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' },
  on: { transform: [{ translateX: 14 }] },
})
