import { Children, Fragment, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import type { Tone } from '../labels'
import { colors, desktop, font, overlay, radii, shadow, size } from '../theme'
import { t } from '../i18n'

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  if (onPress === undefined) return <View style={[styles.card, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  )
}

// 卡片里的多行，行与行之间一条细线
export function Rows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children)
  return (
    <>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i === 0 ? null : <View style={styles.divider} />}
          {row}
        </Fragment>
      ))}
    </>
  )
}

export function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sh}>
        <Text style={styles.shLeft}>{title}</Text>
        {right === undefined ? null : <Text style={styles.shRight}>{right}</Text>}
      </View>
      {children}
    </View>
  )
}

export function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>
}

const toneStyle = {
  g: { backgroundColor: colors.okSoft, color: colors.ok },
  a: { backgroundColor: colors.warnSoft, color: colors.warn },
  r: { backgroundColor: colors.badSoft, color: colors.bad },
  n: { backgroundColor: colors.raised, color: colors.tx2 },
} as const

export function Tag({ label, tone }: { label: string; tone: Tone }) {
  const t = toneStyle[tone]
  return (
    <View style={[styles.tag, { backgroundColor: t.backgroundColor }]}>
      <Text style={[styles.tagText, { color: t.color }]}>{label}</Text>
    </View>
  )
}

export function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />
}

export function Btn({
  label,
  onPress,
  primary,
  icon: Icon,
  disabled,
  danger,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  icon?: LucideIcon
  disabled?: boolean
  danger?: boolean
}) {
  const fg = primary ? colors.onBrand : danger ? colors.bad : colors.tx
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, primary && styles.btnPrimary, (pressed || disabled) && styles.pressed]}
    >
      {Icon === undefined ? null : <Icon size={13} color={fg} strokeWidth={2} />}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

// 动态、事项页的筛选
export function Filter({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filt, on && styles.filtOn]}>
      <Text style={[styles.filtText, on && styles.filtTextOn]}>{label}</Text>
    </Pressable>
  )
}

export function Seg<K extends string>({ options, value, onChange }: { options: [K, string][]; value: K; onChange: (k: K) => void }) {
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

// "等你拍板"卡片里写清每个按钮的后果，如 ['同意后：…', '不要：…']
// 默认收起（每屏减负），点"按了会怎样？"展开
export function Consequences({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Pressable style={styles.consequences} onPress={() => setOpen(!open)} hitSlop={6}>
      {open ? (
        lines.map((l) => (
          <Text key={l} style={styles.consequence}>
            {l}
          </Text>
        ))
      ) : (
        <Text style={styles.consequence}>{t('按了会怎样？')}</Text>
      )}
    </Pressable>
  )
}

// 时间线头像：系统 / 我 / agent
const whoStyle = {
  sys: { label: t('系'), bg: colors.raised, fg: colors.tx2 },
  me: { label: t('我'), bg: colors.line, fg: colors.tx },
  ai: { label: 'AI', bg: colors.brandSoft, fg: colors.brand },
} as const

export function Who({ who }: { who: keyof typeof whoStyle }) {
  const w = whoStyle[who]
  return (
    <View style={[styles.who, { backgroundColor: w.bg }]}>
      <Text style={[styles.whoText, { color: w.fg }]}>{w.label}</Text>
    </View>
  )
}

export const text = StyleSheet.create({
  body: { ...font.regular, color: colors.tx, fontSize: size.title },
  title: { ...font.medium, color: colors.tx, fontSize: size.title },
  strong: { ...font.semibold, color: colors.tx, fontSize: size.body },
  sub: { ...font.regular, color: colors.tx2, fontSize: size.secondary },
  small: { ...font.regular, color: colors.tx2, fontSize: size.secondary },
  meta: { ...font.regular, color: colors.tx2, fontSize: size.small },
  mono: { ...font.regular, color: colors.tx2, fontSize: size.small },
  monoDim: { ...font.regular, color: colors.tx2, fontSize: size.small },
})

const styles = StyleSheet.create({
  // 电脑上卡片不画边框：0.5px 细线 + 极轻阴影（docs/desktop-v2.md 线、叠加、阴影），和底色差一起分层
  card: desktop
    ? { backgroundColor: colors.card, borderRadius: 12, boxShadow: shadow.card }
    : { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radii.card },
  pressed: { opacity: 0.7 },
  divider: { height: 1, backgroundColor: desktop ? overlay.rowLine : colors.line },
  section: { gap: desktop ? 10 : 7 },
  sh: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  // 电脑照 内部界面稿（未公开）：小节标题 14 中粗，不加字距
  shLeft: desktop
    ? { ...font.medium, fontSize: size.secondary, color: colors.tx2 }
    : { ...font.semibold, fontSize: size.small, letterSpacing: 1, color: colors.tx2 },
  shRight: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  consequences: { gap: 1, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.line },
  consequence: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  empty: { ...font.regular, fontSize: size.secondary, color: colors.tx2, paddingVertical: 4 },
  tag: desktop
    ? { borderRadius: 11, paddingHorizontal: 9, paddingVertical: 2, alignSelf: 'flex-start' }
    : { borderRadius: radii.tag, paddingHorizontal: 7, paddingVertical: 1, alignSelf: 'flex-start' },
  tagText: { ...(desktop ? font.medium : font.regular), fontSize: size.small },
  dot: { width: 6, height: 6, borderRadius: 3 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: desktop ? 10 : 11,
    paddingVertical: desktop ? 4 : 5,
    borderRadius: radii.button,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: desktop ? colors.raised : colors.line,
  },
  btnPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnText: { ...(desktop ? font.medium : font.semibold), fontSize: size.secondary },
  filt: desktop
    ? { paddingHorizontal: 11, paddingVertical: 4, borderRadius: radii.chip, backgroundColor: colors.raised }
    : { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.chip, borderWidth: 1, borderColor: colors.line },
  filtOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  filtText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  filtTextOn: { ...font.semibold, color: colors.onBrand },
  // 电脑上是 Mac 式的紧凑分段控件，不铺满整行
  seg: {
    ...(desktop ? { alignSelf: 'flex-start' as const, minWidth: 220 } : {}),
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.seg,
    padding: 3,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: radii.segItem },
  segOn: { backgroundColor: colors.raised },
  segText: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  segTextOn: { ...font.semibold, color: colors.tx },
  who: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  whoText: { ...font.bold, fontSize: size.small },
})
