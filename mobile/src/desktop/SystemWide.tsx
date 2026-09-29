import { useCallback, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native'
import type { AuthList, JobsList, Metrics, Runner, Settings as NotifySettings, Source, SourcesList } from '../api/types'
import { readLastSync } from '../cache'
import { StaleBanner } from '../components/Screen'
import { PwaSettings } from '../components/PwaSettings'
import { Toggle } from '../components/Toggle'
import { useConfig } from '../config/context'
import { humanize } from '../errors'
import { language, t } from '../i18n'
import { jobStatus, sourceName } from '../labels'
import { AGENTS, AGENT_SOURCES, AUTH_LABEL, MAINTAINER, problemsOf, type Problem } from '../problems'
import { pwa } from '../pwa'
import { useRefresh } from '../refresh'
import {
  FIX_CLAUDE,
  FIX_GOOGLE,
  LANGUAGES,
  SCALES,
  SCHEMES,
  interval,
  pickScale,
  pickScheme,
  useAutostart,
  useConnectionForm,
  useNotifyForm,
  useOpenOrca,
  usePickLanguage,
  useStartReview,
  versionLines,
} from '../system-shared'
import { tauri } from '../tauri'
import type { TauriApi } from '../tauri-api'
import { colorSchemeSetting, colors, font, fontScaleName, overlay, size } from '../theme'
import { addDays, ago, todayYmd, when } from '../time'
import { useHub, type HubView } from '../use-hub'
import { useViewTracking } from '../usage'
import { hoverRow } from '../web-data'
import { TopBarD, useScrolled } from './TopBar'
import { dt } from './tokens'
import { BtnD, SegD, Section } from './ui'

// 电脑系统页（docs/desktop-v2.md 逐页方案 7）：720 居中阅读列，macOS 设置那种分组卡片。
// 每行最小 44，左边标签 15 + 说明 13 tx2，右边控件。从上到下：状态（点开看每个数据源）→ 最近 7 天两个数 → 操作三行 → 更多（折叠）。
// 数据和动作与手机页共用 src/system-shared.ts；颜色只跟 hub 算出的 alive / health 走
export function SystemWide() {
  const { config } = useConfig()
  const view = useHub<SourcesList>('/sources')
  const auth = useHub<AuthList>('/auth-status')
  useViewTracking('system')
  const [scrolled, onScroll] = useScrolled()
  const problems = problemsOf(config.hub !== null, view.error !== null, view.data, auth.data)
  return (
    <View style={styles.page}>
      <TopBarD title={t('系统')} sub={null} back={null} tools={null} column={dt.width.read} scrolled={scrolled} />
      <ScrollView contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={100}>
        <View style={styles.column}>
          <StaleBanner view={view} />
          <StatusCard problems={problems} view={view} auth={auth} />
          <MetricsCard />
          <ActionsCard />
          <More startOpen={config.hub === null} />
        </View>
      </ScrollView>
    </View>
  )
}

// 设置行：左标签 15 + 说明 13 tx2，右边控件；可点时悬停叠 hover
function SettingRow({
  label,
  note,
  dot,
  onPress,
  children,
}: {
  label: string
  note: ReactNode | null
  dot: string | null
  onPress: (() => void) | null
  children: ReactNode
}) {
  const body = (
    <>
      {dot === null ? null : <View style={[styles.dot, { backgroundColor: dot }]} />}
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        {note === null ? null : typeof note === 'string' ? <Text style={styles.note}>{note}</Text> : note}
      </View>
      {children}
    </>
  )
  if (onPress === null) return <View style={styles.row}>{body}</View>
  return (
    <Pressable style={styles.row} onPress={onPress} {...hoverRow}>
      {body}
    </Pressable>
  )
}

// 行右侧的小字（时间、状态）
function Side({ text }: { text: string }) {
  return <Text style={styles.side}>{text}</Text>
}

// ---- 状态 ----

function StatusCard({ problems, view, auth }: { problems: Problem[] | null; view: HubView<SourcesList>; auth: HubView<AuthList> }) {
  const [open, setOpen] = useState(false)
  const tone = problems === null ? colors.tx3 : problems.length === 0 ? colors.ok : problems.some((p) => p.bad) ? colors.bad : colors.warn
  const label =
    problems === null
      ? t('检查中…')
      : problems.length === 0
        ? t('一切正常')
        : problems.length === 1
          ? t('有 1 个问题')
          : t('有 {n} 个问题', { n: problems.length })
  const list = problems === null || problems.length === 0 ? null : problems.map((p) => p.text).join(t('、'))
  return (
    <Section title={null} right={null} empty={false}>
      <SettingRow label={label} note={list} dot={tone} onPress={() => setOpen(!open)}>
        <View style={styles.disclose}>
          <Text style={styles.side}>{open ? t('收起') : t('细节')}</Text>
          {open ? <ChevronUp size={14} color={colors.tx3} /> : <ChevronDown size={14} color={colors.tx3} />}
        </View>
      </SettingRow>
      {open ? <HubRow view={view} /> : null}
      {open ? <AgentRows view={view} /> : null}
      {open ? <MaintainerRow source={view.data === null ? undefined : view.data.sources.find((x) => x.name === MAINTAINER)} /> : null}
      {open && view.data !== null
        ? view.data.sources.filter((x) => !AGENT_SOURCES.has(x.name)).map((s) => <SourceRow key={s.name} source={s} />)
        : null}
      {open && auth.data !== null ? auth.data.auth.map((a) => <AuthRow key={a.name} auth={a} />) : null}
      {open && auth.data === null && auth.error !== null ? (
        <SettingRow
          label={t('授权')}
          note={t('读不到授权状态：{error}', { error: humanize(auth.error).message })}
          dot={colors.tx3}
          onPress={null}
        >
          {null}
        </SettingRow>
      ) : null}
    </Section>
  )
}

function HubRow({ view }: { view: HubView<SourcesList> }) {
  const { config } = useConfig()
  const [lastSync, setLastSync] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      readLastSync().then(setLastSync)
    }, [view.fetchedAt]),
  )
  const hubOk = view.error === null && view.live
  const state = config.hub === null ? t('未设置') : hubOk ? t('正常') : view.error === null ? t('连接中') : t('连不上')
  const where = config.hub === null ? t('去"更多"里填地址和令牌') : config.hub.hubUrl
  const synced = t('上次同步 {when}', { when: lastSync === null ? t('从未') : ago(lastSync) })
  return (
    <SettingRow label="Hub" note={`${where} · ${synced}`} dot={hubOk ? colors.ok : colors.bad} onPress={null}>
      <Side text={state} />
    </SettingRow>
  )
}

function AgentRows({ view }: { view: HubView<SourcesList> }) {
  const queued = useHub<JobsList>('/jobs?status=queued')
  const running = useHub<JobsList>('/jobs?status=running')
  const count = (list: JobsList | null, runner: Runner) => (list === null ? null : list.jobs.filter((j) => j.runner === runner).length)
  return (
    <>
      {AGENTS.map((a) => {
        const src = view.data === null ? undefined : view.data.sources.find((x) => x.name === a.source)
        const r = count(running.data, a.runner)
        const q = count(queued.data, a.runner)
        const load =
          r === null || q === null
            ? '…'
            : r === 0 && q === 0
              ? t('空闲')
              : [r > 0 ? t('运行 {n}', { n: r }) : '', q > 0 ? t('排队 {n}', { n: q }) : ''].filter((x) => x !== '').join(' · ')
        const dot = src === undefined ? colors.tx3 : !src.alive ? colors.bad : q !== null && q > 0 && r === 0 ? colors.warn : colors.ok
        const beat =
          src === undefined ? t('未登记') : src.last_seen_at === null ? t('从未心跳') : t('心跳 {ago}', { ago: ago(src.last_seen_at) })
        return (
          <SettingRow key={a.runner} label={a.name} note={`${a.note} · ${beat}`} dot={dot} onPress={null}>
            <Side text={load} />
          </SettingRow>
        )
      })}
    </>
  )
}

function MaintainerRow({ source: s }: { source: Source | undefined }) {
  const note =
    s === undefined
      ? t('还没报过心跳')
      : s.last_seen_at === null
        ? t('从未心跳')
        : s.alive
          ? t('心跳 {ago} · 处理反馈、修问题', { ago: ago(s.last_seen_at) })
          : t('{ago}起没心跳，Mac 会开新会话接班', { ago: ago(s.last_seen_at) })
  return (
    <SettingRow label={t('维护会话')} note={note} dot={s === undefined ? colors.tx3 : s.alive ? colors.ok : colors.bad} onPress={null}>
      <Side text={s === undefined ? '…' : s.alive ? t('在线') : t('失联')} />
    </SettingRow>
  )
}

// 数据源：心跳（活着没）和结果健康（产出对不对）分开；health 是 warn / error 时下面一行写 health_detail
function SourceRow({ source: s }: { source: Source }) {
  const bad = !s.alive || s.health === 'error'
  const dot = bad ? colors.bad : s.health === 'warn' ? colors.warn : colors.ok
  const beat = s.alive
    ? t('应每 {interval} 一次', { interval: interval(s.expected_interval_s) })
    : t('超过 {interval} 没心跳', { interval: interval(s.expected_interval_s) })
  const health =
    s.health === 'warn' || s.health === 'error'
      ? `${s.health === 'error' ? t('出错') : t('需要留意')}${s.health_detail === null ? '' : t('：{detail}', { detail: s.health_detail })}${
          s.health_at === null ? '' : t('（{ago}）', { ago: ago(s.health_at) })
        }`
      : null
  return (
    <SettingRow
      label={sourceName(s.name)}
      note={
        <>
          <Text style={styles.note}>{beat}</Text>
          {health === null ? null : <Text style={styles.note}>{health}</Text>}
        </>
      }
      dot={dot}
      onPress={null}
    >
      <Side text={s.last_seen_at === null ? t('从未') : ago(s.last_seen_at)} />
    </SettingRow>
  )
}

function AuthRow({ auth: a }: { auth: AuthList['auth'][number] }) {
  const note = a.ok ? null : (
    <>
      <Text style={styles.note}>
        {t('失效')}
        {a.detail === null ? '' : t('：{detail}', { detail: a.detail })}
      </Text>
      <Text style={styles.note}>{t('怎么修：{fix}', { fix: a.name.startsWith('claude') ? FIX_CLAUDE : FIX_GOOGLE })}</Text>
    </>
  )
  return (
    <SettingRow label={a.name in AUTH_LABEL ? AUTH_LABEL[a.name] : a.name} note={note} dot={a.ok ? colors.ok : colors.bad} onPress={null}>
      <Side text={ago(a.checked_at)} />
    </SettingRow>
  )
}

// ---- 检验指标（design.md 0.1）：保持两个数，第 3 批再换成图 ----

function MetricsCard() {
  const today = todayYmd()
  const view = useHub<Metrics>(`/metrics?from=${addDays(today, -6)}&to=${today}`)
  if (view.data === null) {
    if (view.error === null) return null
    return (
      <Section title={t('最近 7 天')} right={null} empty={false}>
        <SettingRow label={t('读不到指标：{error}', { error: humanize(view.error).message })} note={null} dot={null} onPress={null}>
          {null}
        </SettingRow>
      </Section>
    )
  }
  const { days, totals } = view.data
  return (
    <Section title={t('最近 7 天')} right={null} empty={false}>
      <SettingRow label={t('打开次数')} note={t('每天：{days}', { days: days.map((d) => d.opens).join(' · ') })} dot={null} onPress={null}>
        <Text style={styles.num}>{totals.opens}</Text>
      </SettingRow>
      <SettingRow label={t('晚间回复')} note={t('晚上问了之后，到次日 04:00 前回了几次')} dot={null} onPress={null}>
        <Text style={styles.num}>
          {totals.evening_replied}/{totals.evening_asked}
        </Text>
      </SettingRow>
    </Section>
  )
}

// ---- 操作：每行右侧一个 28 高的次按钮 ----

function ActionsCard() {
  const { job, start: refresh } = useRefresh()
  const pending = job !== null && (job.status === 'queued' || job.status === 'running')
  const review = useStartReview()
  const openOrca = useOpenOrca()
  const refreshNote =
    job === null
      ? `${t('还没刷新过')} · ${t('Mac 睡着时会排队，醒来执行')}`
      : t('上次刷新 {when} · {status}', { when: job.requested_at === null ? '' : when(job.requested_at), status: jobStatus[job.status] }) +
        (job.error === null ? '' : t('：{detail}', { detail: job.error }))
  return (
    <Section title={t('操作')} right={null} empty={false}>
      <SettingRow label={t('刷新全部')} note={refreshNote} dot={null} onPress={null}>
        <BtnD label={pending ? jobStatus[job.status] : t('刷新')} kind="neutral" size="md" disabled={pending} onPress={refresh} />
      </SettingRow>
      <SettingRow label={t('现在复盘')} note={t('平时在计划结束当晚自动复盘；想提前就点这里')} dot={null} onPress={null}>
        <BtnD label={t('复盘')} kind="neutral" size="md" disabled={review.busy} onPress={review.start} />
      </SettingRow>
      {pwa === null ? (
        <SettingRow label={t('去 Orca')} note={t('在 Orca 里看会话和终端')} dot={null} onPress={null}>
          <BtnD label={t('打开')} kind="neutral" size="md" disabled={false} onPress={openOrca} />
        </SettingRow>
      ) : null}
    </Section>
  )
}

// ---- 更多：保持折叠；展开后的设置也是"左标签、右控件" ----

function More({ startOpen }: { startOpen: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(startOpen)
  const pickLanguage = usePickLanguage()
  return (
    <>
      <Section title={null} right={null} empty={false}>
        <SettingRow label={t('更多')} note={t('设置、反馈、全部动态、版本')} dot={null} onPress={() => setOpen(!open)}>
          {open ? <ChevronUp size={16} color={colors.tx3} /> : <ChevronDown size={16} color={colors.tx3} />}
        </SettingRow>
      </Section>
      {open ? (
        <>
          <Section title={null} right={null} empty={false}>
            <SettingRow label={t('反馈与建议')} note={null} dot={null} onPress={() => router.push('/feedback')}>
              <ChevronRight size={16} color={colors.tx3} />
            </SettingRow>
            <SettingRow label={t('全部动态')} note={null} dot={null} onPress={() => router.push('/feed')}>
              <ChevronRight size={16} color={colors.tx3} />
            </SettingRow>
          </Section>
          <View style={styles.group}>
            <Section title={t('显示')} right={null} empty={false}>
              <SettingRow label={t('字号')} note={null} dot={null} onPress={null}>
                <SegD options={SCALES} value={fontScaleName} onChange={pickScale} />
              </SettingRow>
              <SettingRow label={t('深浅色')} note={null} dot={null} onPress={null}>
                <SegD options={SCHEMES} value={colorSchemeSetting} onChange={pickScheme} />
              </SettingRow>
              <SettingRow label={t('语言')} note={null} dot={null} onPress={null}>
                <SegD options={LANGUAGES} value={language} onChange={pickLanguage} />
              </SettingRow>
            </Section>
            <Text style={styles.foot}>{t('选了之后 app 会重新加载一下')}</Text>
          </View>
          <NotifyCard />
          {tauri === null ? null : <AutostartCard api={tauri} />}
          {pwa === null ? <ConnectionCard /> : <PwaSettings />}
          <Section title={t('版本')} right={null} empty={false}>
            <View style={styles.version}>
              {versionLines().map((l) => (
                <Text key={l} style={styles.versionText} selectable>
                  {l}
                </Text>
              ))}
            </View>
          </Section>
        </>
      ) : null}
    </>
  )
}

function NotifyCard() {
  const view = useHub<NotifySettings>('/settings')
  if (view.data === null) {
    return (
      <Section title={t('早晚通知')} right={t('本地时间')} empty={false}>
        <SettingRow
          label={view.error === null ? t('读取中…') : t('读不到设置：{error}', { error: humanize(view.error).message })}
          note={null}
          dot={null}
          onPress={null}
        >
          {null}
        </SettingRow>
      </Section>
    )
  }
  return <NotifyForm key={JSON.stringify(view.data)} current={view.data} onSaved={view.refresh} />
}

function NotifyForm({ current, onSaved }: { current: NotifySettings; onSaved: () => Promise<void> }) {
  const f = useNotifyForm(current, onSaved)
  return (
    <Section title={t('早晚通知')} right={t('本地时间')} empty={false}>
      <SettingRow label={t('早上简报')} note={null} dot={null} onPress={null}>
        <TextInput
          style={[styles.input, styles.time]}
          value={f.morning}
          onChangeText={f.setMorning}
          placeholder="08:00"
          placeholderTextColor={colors.tx3}
          maxLength={5}
        />
      </SettingRow>
      <SettingRow label={t('晚间提问')} note={t('"今天推进了什么？"，当天记过就不问')} dot={null} onPress={null}>
        <View style={styles.controls}>
          <TextInput
            style={[styles.input, styles.time, !f.eveningOn && styles.off]}
            value={f.evening}
            onChangeText={f.setEvening}
            placeholder="21:00"
            placeholderTextColor={colors.tx3}
            maxLength={5}
            editable={f.eveningOn}
          />
          <Toggle value={f.eveningOn} onChange={f.setEveningOn} disabled={false} />
        </View>
      </SettingRow>
      <View style={styles.saveRow}>
        <Text style={[styles.note, styles.saveNote, !f.valid && { color: colors.bad }]}>{f.valid ? '' : t('时间格式是 HH:MM，比如 08:00')}</Text>
        <BtnD label={t('保存')} kind="primary" size="md" disabled={f.busy || !f.valid || !f.changed} onPress={f.save} />
      </View>
    </Section>
  )
}

function AutostartCard({ api }: { api: TauriApi }) {
  const { on, toggle } = useAutostart(api)
  return (
    <Section title="Mac app" right={null} empty={false}>
      <SettingRow label={t('开机自动打开 Mojito')} note={null} dot={null} onPress={null}>
        {on === null ? <ActivityIndicator size="small" color={colors.tx3} /> : <Toggle value={on} onChange={toggle} disabled={false} />}
      </SettingRow>
    </Section>
  )
}

function ConnectionCard() {
  const f = useConnectionForm()
  return (
    <Section title={t('连接设置')} right={null} empty={false}>
      <SettingRow label={t('hub 地址')} note={null} dot={null} onPress={null}>
        <TextInput
          style={[styles.input, styles.wideInput]}
          value={f.hubUrl}
          onChangeText={f.setHubUrl}
          placeholder="https://hub.example.com"
          placeholderTextColor={colors.tx3}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </SettingRow>
      <SettingRow label={t('app 令牌')} note={null} dot={null} onPress={null}>
        <TextInput
          style={[styles.input, styles.wideInput]}
          value={f.token}
          onChangeText={f.setToken}
          placeholder={t('Bearer 令牌')}
          placeholderTextColor={colors.tx3}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </SettingRow>
      <SettingRow label={t('Orca 链接')} note={t('"去 Orca"打开它，一般填 orca://')} dot={null} onPress={null}>
        <TextInput
          style={[styles.input, styles.wideInput]}
          value={f.orcaUrl}
          onChangeText={f.setOrcaUrl}
          placeholder="orca://"
          placeholderTextColor={colors.tx3}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </SettingRow>
      <View style={styles.saveRow}>
        <Text style={[styles.note, styles.saveNote]}>{t('令牌只存在本机安全存储里，不打进安装包。')}</Text>
        <BtnD label={t('保存')} kind="neutral" size="md" disabled={false} onPress={f.save} />
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: dt.space.pageX, paddingTop: dt.space.pageTop, paddingBottom: 48 },
  column: { width: '100%', maxWidth: dt.width.read, alignSelf: 'center', gap: dt.space.section },
  group: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: dt.space.rowV,
    paddingHorizontal: dt.space.rowH,
  },
  rowText: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-start', marginTop: (dt.line.body - 8) / 2 },
  label: { ...font.regular, fontSize: size.body, lineHeight: dt.line.body, color: colors.tx },
  note: { ...font.regular, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2 },
  side: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disclose: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  num: { ...font.mono, fontSize: size.body, color: colors.tx },
  foot: { ...font.regular, fontSize: size.small, color: colors.tx3, paddingHorizontal: dt.space.rowH },
  input: {
    ...font.regular,
    height: dt.height.btnMd,
    paddingHorizontal: 8,
    borderRadius: dt.radius.btn,
    backgroundColor: overlay.fill,
    color: colors.tx,
    fontSize: size.secondary,
  },
  time: { ...font.mono, width: 72, textAlign: 'center' },
  wideInput: { width: 300 },
  off: { opacity: 0.4 },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: dt.space.rowV,
    paddingHorizontal: dt.space.rowH,
  },
  saveNote: { flex: 1 },
  version: { paddingVertical: dt.space.cardV, paddingHorizontal: dt.space.cardH, gap: 2 },
  versionText: { ...font.mono, fontSize: size.small, color: colors.tx2, userSelect: 'text' },
})
