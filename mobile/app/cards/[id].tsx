import { useLocalSearchParams } from 'expo-router'
import type { Card, ProjectsList } from '../../src/api/types'
import { CardView } from '../../src/components/CardView'
import { Screen } from '../../src/components/Screen'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { useChatSubject } from '../../src/wide'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 卡片详情：摘要全文和全部动作（GET /cards/{id}，不论状态）
export default function CardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const view = useHub<Card>(`/cards/${encodeURIComponent(id)}`)
  const projects = useHub<ProjectsList>('/projects')
  useViewTracking('card_detail')
  useChatSubject(view.data === null ? null : { kind: 'card', id, title: view.data.title })
  return (
    <Screen view={view} head={{ kind: 'back', label: t('信息流') }}>
      {(card) => {
        const found =
          card.project_id === null || projects.data === null ? undefined : projects.data.projects.find((p) => p.id === card.project_id)
        return <CardView card={card} project={found === undefined ? null : found} full />
      }}
    </Screen>
  )
}
