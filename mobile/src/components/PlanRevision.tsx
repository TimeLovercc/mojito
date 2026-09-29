import { StyleSheet, Text, View } from 'react-native'
import type { ItemsList, Plan, PlansList } from '../api/types'
import { colors, font, size } from '../theme'
import { useHub } from '../use-hub'
import { t } from '../i18n'

// 修订版计划和原计划相比：新增、去掉了哪些事项（对话里改计划时 agent 起草）
export function PlanRevision({ plan }: { plan: Plan }) {
  const plans = useHub<PlansList>('/plans')
  const items = useHub<ItemsList>('/items')
  if (plan.revises === null) return null
  const original = plans.data === null ? undefined : plans.data.plans.find((p) => p.id === plan.revises)
  if (original === undefined) return <Text style={styles.line}>{t('修订 {id}', { id: plan.revises })}</Text>
  const title = (id: string) => {
    const item = items.data === null ? undefined : items.data.items.find((i) => i.id === id)
    return item === undefined ? id : item.title
  }
  const added = plan.item_ids.filter((id) => !original.item_ids.includes(id))
  const removed = original.item_ids.filter((id) => !plan.item_ids.includes(id))
  return (
    <View style={styles.wrap}>
      {added.map((id) => (
        <Text key={`+${id}`} style={[styles.line, { color: colors.ok }]}>
          ＋ {title(id)}
        </Text>
      ))}
      {removed.map((id) => (
        <Text key={`-${id}`} style={[styles.line, { color: colors.bad }]}>
          － {title(id)}
        </Text>
      ))}
      {added.length + removed.length === 0 ? <Text style={styles.line}>{t('事项没变（可能改了目标）')}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  line: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
})
