import { Children, Fragment, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { colors, font, overlay, shadow, size } from '../theme'
import { hoverRow } from '../web-data'
import { dt } from './tokens'

// 桌面基础控件（docs/desktop-v2.md 控件、第 2 批 2a）：只在电脑密度下渲染的页面主体用，手机不用。

// 列表行：内边距 10×16、最小 36；可点时悬停叠 hover、选中叠 selected
export function Row({
  children,
  onPress,
  selected,
  style,
}: {
  children: ReactNode
  onPress: (() => void) | null
  selected: boolean
  style?: StyleProp<ViewStyle>
}) {
  if (onPress === null) return <View style={[styles.row, selected && styles.selected, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && styles.selected, style]} {...hoverRow}>
      {children}
    </Pressable>
  )
}

// 小节：标题 13/500 tx2（右侧可放小字），下面一张卡，行间 hair 分隔。没有内容（empty）时整块不显示（8.5a）。
// title 为 null 时只有卡（系统页的状态卡，像 macOS 设置里不带标题的分组）
export function Section({
  title,
  right,
  empty,
  children,
}: {
  title: string | null
  right: string | null
  empty: boolean
  children: ReactNode
}) {
  if (empty) return null
  const rows = Children.toArray(children)
  return (
    <View style={styles.section}>
      {title === null ? null : (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {right === null ? null : <Text style={styles.sectionRight}>{right}</Text>}
        </View>
      )}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i === 0 ? null : <View style={styles.hair} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  )
}

// 胶囊：高 20、左右 8、12/500、全圆角。状态色只表示状态（逾期 warn、被忘了 / 失败 bad、完成 ok），其余中性
export type PillTone = 'neutral' | 'warn' | 'bad' | 'ok'
const pillTone: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: overlay.fill, fg: colors.tx2 },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.badSoft, fg: colors.bad },
  ok: { bg: colors.okSoft, fg: colors.ok },
}
// mono：纯时间 / 数字用 Geist Mono（菜单栏主块的"17:00"）
export function Pill({ label, tone, mono }: { label: string; tone: PillTone; mono?: boolean }) {
  const t = pillTone[tone]
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, mono === true && font.monoMedium, { color: t.fg }]}>{label}</Text>
    </View>
  )
}

// 按钮 sm / md：高 24 / 28，文字 13/500，圆角 6，宽度随内容（靠父容器 alignItems，不在按钮上写 alignSelf）。
// primary 实心品牌色（每屏最多 1–2 处）；neutral 中性底；accept 中性底 + 品牌色字（"同意"）；ghost 无底 tx2（"不要"）
export type BtnKind = 'primary' | 'neutral' | 'accept' | 'ghost'
const btnKind: Record<BtnKind, { bg: string; fg: string }> = {
  primary: { bg: colors.brand, fg: colors.onBrand },
  neutral: { bg: overlay.fill, fg: colors.tx },
  accept: { bg: overlay.fill, fg: colors.brand },
  ghost: { bg: 'transparent', fg: colors.tx2 },
}
export function BtnD({
  label,
  kind,
  size: s,
  onPress,
  disabled,
  icon: Icon,
}: {
  label: string
  kind: BtnKind
  // xs 22（菜单栏面板）/ sm 24 / md 28
  size: 'xs' | 'sm' | 'md'
  onPress: () => void
  disabled: boolean
  icon?: LucideIcon
}) {
  const k = btnKind[kind]
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        s === 'xs' ? styles.btnXs : s === 'sm' ? styles.btnSm : styles.btnMd,
        { backgroundColor: k.bg },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {Icon === undefined ? null : <Icon size={14} color={k.fg} strokeWidth={1.8} />}
      <Text style={[styles.btnText, s === 'xs' && styles.btnTextXs, { color: k.fg }]}>{label}</Text>
    </Pressable>
  )
}

// 图标按钮：28 见方、图标 16，悬停叠 hover（顶栏工具、"⋯"）
export function IconBtn({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.iconBtn} {...hoverRow}>
      <Icon size={16} color={colors.tx2} strokeWidth={1.8} />
    </Pressable>
  )
}

// 分段控件：高 24，轨道 fill，选中项白底（深色 raised）+ 轻阴影
export function SegD<K extends string>({ options, value, onChange }: { options: [K, string][]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={styles.seg}>
      {options.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={[styles.segItem, value === k && styles.segOn]}>
          <Text style={[styles.segText, value === k && styles.segTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: dt.height.row1,
    paddingVertical: dt.space.rowV,
    paddingHorizontal: dt.space.rowH,
    borderRadius: dt.radius.row,
  },
  selected: { backgroundColor: overlay.selected },
  section: { gap: dt.space.sectionHead },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { ...font.medium, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2 },
  sectionRight: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  card: { backgroundColor: colors.card, borderRadius: dt.radius.card, boxShadow: shadow.card, overflow: 'hidden' },
  hair: { height: 1, backgroundColor: overlay.rowLine, marginHorizontal: dt.space.rowH },
  // 对齐方式由所在的行决定（行内居中、列里靠左）
  pill: { height: dt.height.pill, paddingHorizontal: 8, borderRadius: dt.radius.pill, justifyContent: 'center' },
  pillText: { ...font.medium, fontSize: size.small },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: dt.radius.btn },
  btnXs: { height: 22, paddingHorizontal: 8 },
  btnTextXs: { fontSize: size.small },
  btnSm: { height: dt.height.btnSm, paddingHorizontal: 10 },
  btnMd: { height: dt.height.btnMd, paddingHorizontal: 12 },
  btnText: { ...font.medium, fontSize: size.secondary },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  iconBtn: {
    width: dt.height.iconBtn,
    height: dt.height.iconBtn,
    borderRadius: dt.radius.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seg: { flexDirection: 'row', height: dt.height.seg, padding: 2, borderRadius: 7, backgroundColor: overlay.fill, alignSelf: 'flex-start' },
  segItem: { paddingHorizontal: 10, borderRadius: 5, justifyContent: 'center' },
  segOn: { backgroundColor: colors.card, boxShadow: '0 1px 2px rgba(0,0,0,.12)' },
  segText: { ...font.medium, fontSize: size.small, color: colors.tx2 },
  segTextOn: { color: colors.tx },
})
