import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { GoalsList, ItemCategory, ItemsList, ItemStatus } from '../../src/api/types'
import { ItemRow } from '../../src/components/ItemRow'
import { Screen } from '../../src/components/Screen'
import { Card, Empty, Filter, Rows, Section } from '../../src/components/ui'
import { category, itemStatus } from '../../src/labels'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

const CATEGORIES = Object.keys(category) as ItemCategory[]
const STATUSES = Object.keys(itemStatus) as ItemStatus[]

export default function ItemsScreen() {
  // null 表示不按这一项筛选
  const [cat, setCat] = useState<ItemCategory | null>(null)
  const [status, setStatus] = useState<ItemStatus | null>(null)
  const query = new URLSearchParams()
  if (cat !== null) query.set('category', cat)
  if (status !== null) query.set('status', status)
  const qs = query.toString()
  const view = useHub<ItemsList>(qs === '' ? '/items' : `/items?${qs}`)
  const goals = useHub<GoalsList>('/goals')
  useViewTracking('items')

  const filters = (
    <View style={styles.filters}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filt}>
        <Filter label={t('全部分类')} on={cat === null} onPress={() => setCat(null)} />
        {CATEGORIES.map((c) => (
          <Filter key={c} label={category[c].label} on={cat === c} onPress={() => setCat(c)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filt}>
        <Filter label={t('全部状态')} on={status === null} onPress={() => setStatus(null)} />
        {STATUSES.map((s) => (
          <Filter key={s} label={itemStatus[s].label} on={status === s} onPress={() => setStatus(s)} />
        ))}
      </ScrollView>
    </View>
  )

  return (
    <Screen view={view} head={{ kind: 'back', label: t('项目') }} top={filters}>
      {(list) => (
        <Section title={t('全部事项')} right={String(list.items.length)}>
          {list.items.length === 0 ? (
            <Empty text={t('没有符合条件的事项')} />
          ) : (
            <Card style={{ paddingVertical: 4 }}>
              <Rows>
                {list.items.map((i) => (
                  <ItemRow key={i.id} item={i} goals={goals.data === null ? null : goals.data.goals} showStatus />
                ))}
              </Rows>
            </Card>
          )}
        </Section>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  filters: { gap: 8 },
  filt: { gap: 6 },
})
