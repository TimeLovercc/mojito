import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget'
import { clock, longDate, todayYmd, weekdayOf } from '../../src/time'
import { t } from '../../src/i18n'
import { decideCount, decideLines, focusText, type TodayV3 } from './decide'
import type { Item } from '../../src/api/types'
import { T, W } from './style'
import { isStale, type TodayState } from './TodayWidget'

// 大 widget（4×6，docs/api.md "大批改进" 2）：日期 + 件数 → 今日重点 ≤5 → 等你拍板 ≤2 → 逾期 ≤2 → 被忘了 ≤2（空块不显示，design 8.5a） → "笔记""对话"。不放日程。
const FOCUS_MAX = 5
const DECIDE_MAX = 2
const OVERDUE_MAX = 2
const FORGOTTEN_MAX = 2

const itemUri = (id: string) => `mojito://items/${encodeURIComponent(id)}`

function Title({ text, right }: { text: string; right: string }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', marginTop: 6 }}>
      <TextWidget text={text} style={{ fontSize: T.small, color: W.tx2 }} />
      <TextWidget text={right} style={{ fontSize: T.small, color: W.tx2, fontFamily: W.mono }} />
    </FlexWidget>
  )
}

function Row({ text, uri, color, box }: { text: string; uri: string; color: typeof W.tx; box: boolean }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{ flexDirection: 'row', alignItems: 'center', flexGap: 7, width: 'match_parent', paddingVertical: 3 }}
    >
      {box ? (
        <FlexWidget style={{ width: 12, height: 12, borderRadius: 4, borderWidth: 1.5, borderColor: W.line2 }} />
      ) : (
        <FlexWidget style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      )}
      <TextWidget text={text} maxLines={1} truncate="END" style={{ fontSize: T.body, color: W.tx }} />
    </FlexWidget>
  )
}

function Muted({ text }: { text: string }) {
  return <TextWidget text={text} style={{ fontSize: T.minor, color: W.tx2, paddingVertical: 3 }} />
}

const more = (total: number, shown: number) => (total > shown ? `+${total - shown}` : String(total))

function Button({ label, uri, primary }: { label: string; uri: string; primary: boolean }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        flex: 1,
        height: 44,
        borderRadius: 22,
        backgroundColor: primary ? W.btn : W.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <TextWidget text={label} style={{ fontSize: T.body, color: primary ? W.btnTx : W.tx }} />
    </FlexWidget>
  )
}

type BlockRow = { key: string; text: string; uri: string }

// 一块：没有内容就连标题一起不显示（design 8.5a）。widget 库不接受返回 null 的组件，所以这里是普通函数，空时返回 null 由父节点过滤掉
function block(title: string, rows: BlockRow[], max: number, color: typeof W.tx, box: boolean) {
  if (rows.length === 0) return null
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <Title text={title} right={more(rows.length, max)} />
      {rows.slice(0, max).map((r) => (
        <Row key={r.key} text={r.text} uri={r.uri} color={color} box={box} />
      ))}
    </FlexWidget>
  )
}

const itemRows = (items: Item[]): BlockRow[] => items.map((i) => ({ key: i.id, text: i.title, uri: itemUri(i.id) }))

function Body({ today, fetchedAt, now }: { today: TodayV3; fetchedAt: string; now: Date }) {
  // 今日重点 = 今天到期 + 今天之后最近的一件（"还有 N 天"）；顶部"今天到期 N"只数今天的
  const focus = today.focus
  const dueToday = focus.filter((i) => i.days_until === 0).length
  const decide = decideCount(today)
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent' }}>
      <TextWidget
        text={decide === 0 ? t('今天到期 {n}', { n: dueToday }) : t('今天到期 {n} · 等你拍板 {m}', { n: dueToday, m: decide })}
        style={{ fontSize: T.minor, color: decide === 0 ? W.tx2 : W.amber }}
      />
      {focus.length === 0 ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <Title text={t('今日重点')} right="0" />
          <Muted text={t('今天没有到期的事')} />
        </FlexWidget>
      ) : (
        block(
          t('今日重点'),
          focus.map((i) => ({ key: i.id, text: focusText(i), uri: itemUri(i.id) })),
          FOCUS_MAX,
          W.tx,
          true,
        )
      )}
      {block(t('等你拍板'), decideLines(today).map((d) => ({ ...d, uri: 'mojito://' })), DECIDE_MAX, W.amber, false)}
      {block(t('逾期'), itemRows(today.overdue), OVERDUE_MAX, W.amber, false)}
      {block(t('被忘了'), itemRows(today.forgotten), FORGOTTEN_MAX, W.red, false)}
      {isStale(fetchedAt, now) ? (
        <TextWidget text={t('数据来自 {time}', { time: clock(fetchedAt) })} style={{ fontSize: T.small, color: W.tx2, marginTop: 6 }} />
      ) : null}
    </FlexWidget>
  )
}

export function BigWidget({ state }: { state: TodayState }) {
  const now = new Date()
  const ymd = todayYmd()
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: W.bg,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: W.border,
        padding: 14,
        flexDirection: 'column',
        flexGap: 4,
      }}
    >
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'mojito://' }}
        style={{ flexDirection: 'row', alignItems: 'center', flexGap: 8, width: 'match_parent' }}
      >
        <ImageWidget image={require('../../assets/widget-avatar.png')} imageWidth={24} imageHeight={24} />
        <TextWidget text={`${longDate(ymd)} ${weekdayOf(ymd)}`} style={{ fontSize: T.card, color: W.tx, fontWeight: '600' }} />
      </FlexWidget>
      {state.kind === 'empty' ? (
        <FlexWidget style={{ flex: 1 }}>
          <Muted text={state.reason} />
        </FlexWidget>
      ) : (
        <Body today={state.today as unknown as TodayV3} fetchedAt={state.fetchedAt} now={now} />
      )}
      <FlexWidget style={{ flexDirection: 'row', flexGap: 8, width: 'match_parent' }}>
        <Button label={t('笔记')} uri="mojito://note" primary />
        <Button label={t('对话')} uri="mojito://chat" primary={false} />
      </FlexWidget>
    </FlexWidget>
  )
}
