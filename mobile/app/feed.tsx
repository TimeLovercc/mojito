import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { actions, hubRequest } from '../src/api/client'
import type { HubRecord, RecordsPage } from '../src/api/types'
import { RecordLine } from '../src/components/RecordLine'
import { Screen } from '../src/components/Screen'
import { Btn, Empty, Filter } from '../src/components/ui'
import { useConfig } from '../src/config/context'
import { clock, dayLabel, ymdOf } from '../src/time'
import { useErrorToast, useToast } from '../src/toast'
import { colors, font, size } from '../src/theme'
import { useHub } from '../src/use-hub'
import { useViewTracking } from '../src/usage'
import { useMarkReadOnLeave } from '../src/read-mark'
import { t } from '../src/i18n'

const PAGE = 30

type Kind = 'all' | 'system' | 'me' | 'chat'
const FILTERS: [Kind, string][] = [
  ['all', t('全部')],
  ['system', t('系统')],
  ['me', t('笔记')],
  ['chat', t('对话')],
]

// 系统：系统写的非对话记录；笔记：我写的非对话记录；对话：kind=chat（双方）
const KEEP: Record<Kind, (r: HubRecord) => boolean> = {
  all: () => true,
  system: (r) => r.author === 'system' && r.kind !== 'chat',
  me: (r) => r.author === 'me' && r.kind !== 'chat',
  chat: (r) => r.kind === 'chat',
}

// 全部动态（系统页进入）：撤销、系统事件、Claude 改过什么都在这里核对。一条时间线：倒序，按天分组；"上次读到这里"以下是旧的（变暗），有尽头。
export default function FeedScreen() {
  const view = useHub<RecordsPage>(`/records?limit=${PAGE}`)
  useViewTracking('timeline')
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [kind, setKind] = useState<Kind>('all')
  // 标题以【测试】开头的是各会话自测写的记录，默认不看
  const [showTest, setShowTest] = useState(false)
  const [older, setOlder] = useState<HubRecord[]>([])
  const [exhausted, setExhausted] = useState(false)

  const page = view.data
  useEffect(() => {
    setOlder([])
    setExhausted(page !== null && page.records.length < PAGE)
  }, [page])

  // 离开动态页时把看到的最新一条记为已读；看的过程中分界线不动
  const newest = page !== null && page.records.length > 0 ? page.records[0].id : null
  useMarkReadOnLeave(newest, page === null ? null : page.last_read_id, view.live, actions.markRead)

  const loadOlder = async (all: HubRecord[]) => {
    if (config.hub === null) throw new Error('没有 hub 配置')
    const last = all[all.length - 1]
    try {
      const next = await hubRequest<RecordsPage>(config.hub, 'GET', `/records?limit=${PAGE}&before=${encodeURIComponent(last.id)}`)
      setOlder((prev) => [...prev, ...next.records])
      if (next.records.length < PAGE) setExhausted(true)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('加载失败'), err)
    }
  }

  const filters = (
    <View style={styles.filt}>
      {FILTERS.map(([k, label]) => (
        <Filter key={k} label={label} on={kind === k} onPress={() => setKind(k)} />
      ))}
      <View style={{ flex: 1 }} />
      <Filter label={t('显示测试')} on={showTest} onPress={() => setShowTest(!showTest)} />
    </View>
  )

  return (
    <Screen
      view={view}
      head={{ kind: 'back', label: t('返回') }}
      top={
        <>
          <Text style={styles.heading}>{t('全部动态')}</Text>
          {filters}
        </>
      }
    >
      {({ records, last_read_id }) => {
        const all = [...records, ...older]
        const cut = last_read_id === null ? -1 : all.findIndex((r) => r.id === last_read_id)
        const keep = (r: HubRecord) => KEEP[kind](r) && (showTest || !r.title.startsWith('【测试】'))
        const fresh = (cut === -1 ? all : all.slice(0, cut)).filter(keep)
        const read = (cut === -1 ? [] : all.slice(cut)).filter(keep)
        // 已读位置还没加载到：新动态还没显示完
        const unreadPending = cut === -1 && last_read_id !== null && !exhausted
        return (
          <View style={styles.list}>
            {fresh.length === 0 ? <Empty text={t('没有新动态')} /> : <Timeline records={fresh} />}
            {unreadPending ? <Btn label={t('还有新动态，继续加载')} onPress={() => loadOlder(all)} /> : null}
            {cut === -1 ? null : (
              <View style={styles.readmark}>
                <View style={styles.line} />
                <Text style={styles.readText}>{t('上次读到这里')}</Text>
                <View style={styles.line} />
              </View>
            )}
            {read.length === 0 ? null : (
              <View style={styles.old}>
                <Timeline records={read} />
              </View>
            )}
            {!unreadPending && !exhausted ? (
              <View style={{ flexDirection: 'row' }}>
                <Btn label={t('再往前')} onPress={() => loadOlder(all)} />
              </View>
            ) : null}
            {exhausted ? <Text style={styles.end}>{t('没有更早的了')}</Text> : null}
          </View>
        )
      }}
    </Screen>
  )
}

function Timeline({ records }: { records: HubRecord[] }) {
  const rows: ReactNode[] = []
  let day: string | null = null
  for (const r of records) {
    const d = ymdOf(new Date(r.at))
    if (d !== day) {
      day = d
      rows.push(
        <Text key={`day-${d}-${r.id}`} style={styles.day}>
          {dayLabel(d)}
        </Text>,
      )
    }
    rows.push(<RecordLine key={r.id} record={r} linkItem showDate={clock} />)
  }
  return <View>{rows}</View>
}

const styles = StyleSheet.create({
  heading: { ...font.bold, fontSize: size.page, color: colors.tx },
  filt: { flexDirection: 'row', gap: 6 },
  list: { gap: 6 },
  day: { ...font.semibold, fontSize: size.small, letterSpacing: 0.9, color: colors.tx2, marginTop: 6 },
  readmark: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  line: { flex: 1, height: 1, backgroundColor: colors.brandSoft },
  readText: { ...font.regular, fontSize: size.small, color: colors.brand },
  old: { opacity: 0.45 },
  end: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'center', marginTop: 8 },
})
