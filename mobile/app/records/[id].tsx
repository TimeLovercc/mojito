import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import type { HubRecord, ItemsList, ProjectsList } from '../../src/api/types'
import { RecordLine } from '../../src/components/RecordLine'
import { Screen } from '../../src/components/Screen'
import { Btn, Card } from '../../src/components/ui'
import { when } from '../../src/time'
import { colors, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 单条记录（文字里的记录链接跳到这里）：全文、项目、挂的事项
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const view = useHub<HubRecord>(`/records/${encodeURIComponent(id)}`)
  const projects = useHub<ProjectsList>('/projects')
  return (
    <Screen view={view} head={{ kind: 'back', label: t('返回') }}>
      {(record) => {
        const project =
          record.project_id === null || projects.data === null ? undefined : projects.data.projects.find((p) => p.id === record.project_id)
        return (
          <>
            <Card style={{ paddingHorizontal: 13, paddingVertical: 4 }}>
              <RecordLine record={record} linkItem={false} showDate={when} />
            </Card>
            {project === undefined ? null : <Text style={styles.meta}>{t('项目：{title}', { title: project.title })}</Text>}
            {record.item_id === null ? null : <ItemLink itemId={record.item_id} label={t('挂在事项')} />}
          </>
        )
      }}
    </Screen>
  )
}

function ItemLink({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter()
  const items = useHub<ItemsList>('/items')
  const item = items.data === null ? undefined : items.data.items.find((i) => i.id === itemId)
  return (
    <View style={{ flexDirection: 'row' }}>
      <Btn
        label={t('{label}：{title}', { label, title: item === undefined ? t('打开') : item.title })}
        icon={ChevronRight}
        onPress={() => router.push({ pathname: '/items/[id]', params: { id: itemId } })}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  meta: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
})
