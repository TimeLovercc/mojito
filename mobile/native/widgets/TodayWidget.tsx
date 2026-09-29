import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget'
import type { Today } from '../../src/api/types'
import { clock } from '../../src/time'
import { t } from '../../src/i18n'
import { decideCount, focusText, type TodayV3 } from './decide'
import { T, W } from './style'

// 没设置 hub、还没拿到过数据时的样子
export type TodayState = { kind: 'ready'; today: Today; fetchedAt: string } | { kind: 'empty'; reason: string }

// 数据超过一小时没更新就标出来，和 app 里"数据来自 <时间>"一致
export function isStale(fetchedAt: string, now: Date): boolean {
  return now.getTime() - new Date(fetchedAt).getTime() > 3600_000
}

function nextEvent(today: Today, now: Date): Today['schedule'][number] | null {
  const upcoming = today.schedule.filter((e) => !e.all_day && new Date(e.end) > now)
  return upcoming.length === 0 ? null : upcoming[0]
}

function Header() {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
      <ImageWidget image={require('../../assets/widget-avatar.png')} imageWidth={16} imageHeight={16} />
      <TextWidget text={t('今天')} style={{ fontSize: T.small, color: W.tx2 }} />
    </FlexWidget>
  )
}

function Line({ text }: { text: string }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6, width: 'match_parent' }}>
      <FlexWidget style={{ width: 12, height: 12, borderRadius: 4, borderWidth: 1.5, borderColor: W.line2 }} />
      <TextWidget text={text} maxLines={1} truncate="END" style={{ fontSize: T.minor, color: W.tx }} />
    </FlexWidget>
  )
}

export function TodayWidget({ state }: { state: TodayState }) {
  const now = new Date()
  const body =
    state.kind === 'empty'
      ? [<TextWidget key="e" text={state.reason} style={{ fontSize: T.minor, color: W.tx2 }} />]
      : todayLines(state.today, state.fetchedAt, now)
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: W.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: W.border,
        padding: 12,
        flexDirection: 'column',
        flexGap: 6,
      }}
    >
      <Header />
      {body}
    </FlexWidget>
  )
}

function todayLines(today: Today, fetchedAt: string, now: Date) {
  const lines = (today as unknown as TodayV3).focus.slice(0, 3).map((i) => <Line key={i.id} text={focusText(i)} />)
  const event = nextEvent(today, now)
  if (event !== null) {
    lines.push(
      <TextWidget
        key="ev"
        text={`${clock(event.start)} ${event.title}`}
        maxLines={1}
        truncate="END"
        style={{ fontSize: T.minor, color: W.tx2 }}
      />,
    )
  }
  const waiting = decideCount(today)
  const stale = isStale(fetchedAt, now)
  lines.push(
    <FlexWidget key="foot" style={{ flex: 1, flexDirection: 'column', justifyContent: 'flex-end', width: 'match_parent' }}>
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent' }}>
        <TextWidget text={waiting === 0 ? '' : t('等你拍板 {n} 件', { n: waiting })} style={{ fontSize: T.small, color: W.amber }} />
        {stale ? (
          <TextWidget text={t('数据来自 {time}', { time: clock(fetchedAt) })} style={{ fontSize: T.small, color: W.tx2 }} />
        ) : (
          <TextWidget text="" />
        )}
      </FlexWidget>
    </FlexWidget>,
  )
  return lines
}
