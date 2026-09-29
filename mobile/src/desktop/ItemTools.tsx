import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { Item } from '../api/types'
import { LifecycleConfirm, useItemDecide } from '../components/Decision'
import { t, tc } from '../i18n'
import { Menu } from './Menu'
import { BtnD } from './ui'

// 电脑事项详情顶栏右侧（docs/desktop-v2.md 逐页方案 3）：sm"完成"，关闭 / 重新打开放进"⋯"，点了仍先确认
export function ItemToolsD({ item }: { item: Item }) {
  const { busy, decide } = useItemDecide(item)
  const [confirm, setConfirm] = useState(false)
  const ended = item.status === 'done' || item.status === 'closed'
  return (
    <View style={styles.tools}>
      {ended ? null : <BtnD label={t('完成')} kind="primary" size="sm" disabled={busy} onPress={() => decide({ action: 'done' }, t('已完成'))} />}
      <Menu
        label={t('更多操作')}
        items={[{ label: ended ? t('重新打开') : tc('按钮', '关闭'), danger: !ended, onPress: () => setConfirm(true) }]}
      />
      <LifecycleConfirm item={item} open={confirm} onClose={() => setConfirm(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
