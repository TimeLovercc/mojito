import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { ProjectDetail, ResearchMap } from '../../src/api/types'
import { ProjectDecision } from '../../src/components/Decision'
import { ResearchCard } from '../../src/components/ResearchCard'
import { Screen } from '../../src/components/Screen'
import { LIFE, both, placeName } from '../../src/research'
import { useHub } from '../../src/use-hub'
import { useScreenIds, useViewTracking } from '../../src/usage'
import { useChatSubject } from '../../src/wide'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 项目详情（手机，design.md 8.13）：研究地图里点一个项目进来的全屏卡片（components/ResearchCard），底下是项目动作
// （暂停 / 完成 / 恢复；新发现的项目是确认 / 不要）。不在地图上的项目（新发现的、故意不放的）照样显示卡片，位置写"不在研究地图上"
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const detail = useHub<ProjectDetail>(`/projects/${encodeURIComponent(id)}`)
  const map = useHub<ResearchMap>('/research-map')
  useViewTracking('project_detail')
  useScreenIds(null, id)
  useChatSubject(detail.data === null ? null : { kind: 'project', id, title: detail.data.project.title })
  return (
    <Screen view={both(detail, map)} head={{ kind: 'back', label: t('项目') }}>
      {({ a: { project: p }, b: m }) => {
        const entry = m.projects.find((x) => x.id === p.id)
        return (
          <View style={styles.col}>
            <ResearchCard
              project={p}
              place={entry === undefined ? t('不在研究地图上') : placeName(m, entry.area)}
              life={entry === undefined ? p.area === 'life' : entry.area === LIFE}
              chats={entry === undefined ? { claude: [], chatgpt: [] } : entry.chats}
            />
            <ProjectDecision project={p} />
          </View>
        )
      }}
    </Screen>
  )
}

const styles = StyleSheet.create({
  col: { gap: 16 },
})
