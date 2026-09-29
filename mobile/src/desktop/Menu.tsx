import { useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MoreHorizontal } from 'lucide-react-native'
import { colors, font, shadow, size } from '../theme'
import { hoverRow } from '../web-data'
import { IconBtn } from './ui'
import { dt } from './tokens'

export type MenuItem = { label: string; onPress: () => void; danger: boolean }

// "⋯"菜单（docs/desktop-v2.md 项目、事项详情）：28 的图标按钮，点开在它下方右对齐弹出。
// 用 RN Modal 渲染到最外层，避免被 react-native-web 的层叠上下文盖住；点外面关闭
export function Menu({ items, label }: { items: MenuItem[]; label: string }) {
  const anchor = useRef<View>(null)
  const { width } = useWindowDimensions()
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const open = () => anchor.current?.measureInWindow((x, y, w, h) => setAt({ top: y + h + 4, right: Math.max(8, width - (x + w)) }))
  return (
    <View ref={anchor} collapsable={false}>
      <IconBtn icon={MoreHorizontal} label={label} onPress={open} />
      <Modal visible={at !== null} transparent animationType="none" onRequestClose={() => setAt(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAt(null)}>
          {at === null ? null : (
            <View style={[styles.pop, { top: at.top, right: at.right }]}>
              {items.map((it) => (
                <Pressable
                  key={it.label}
                  style={styles.item}
                  onPress={() => {
                    setAt(null)
                    it.onPress()
                  }}
                  {...hoverRow}
                >
                  <Text style={[styles.itemText, it.danger && { color: colors.bad }]}>{it.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  pop: {
    position: 'absolute',
    minWidth: 160,
    padding: 4,
    borderRadius: dt.radius.popover,
    backgroundColor: colors.card,
    boxShadow: shadow.popover,
  },
  item: { height: 28, paddingHorizontal: 10, borderRadius: dt.radius.btn, justifyContent: 'center' },
  itemText: { ...font.regular, fontSize: size.secondary, color: colors.tx },
})
