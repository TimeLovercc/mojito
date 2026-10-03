import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  List as ListIcon,
  MessageSquareWarning,
  NotebookText,
  RefreshCw,
} from 'lucide-react-native'
import type { AuthList, JobsList, Metrics, Runner, Settings as NotifySettings, Source, SourcesList } from '../src/api/types'
import { readLastSync } from '../src/cache'
import { Screen } from '../src/components/Screen'
import { Btn, Card, Empty, Filter, Rows, Section } from '../src/components/ui'
import { useConfig } from '../src/config/context'
import { jobStatus } from '../src/labels'
import { useRefresh } from '../src/refresh'
import { addDays, ago, todayYmd, when } from '../src/time'
import {
  colorSchemeSetting,
  colors,
  desktop,
  font,
  fontScaleName,
  radii,
  size,
} from '../src/theme'
import { language, t } from '../src/i18n'
import { humanize } from '../src/errors'
import { useHub, type HubView } from '../src/use-hub'
import { useViewTracking } from '../src/usage'
import { tauri } from '../src/tauri'
import { AGENTS, AGENT_SOURCES, AUTH_LABEL, MAINTAINER, problemsOf, type Problem } from '../src/problems'
import { Toggle } from '../src/components/Toggle'
import { useWide } from '../src/wide'
import type { TauriApi } from '../src/tauri-api'
import { pwa } from '../src/pwa'
import { PwaSettings } from '../src/components/PwaSettings'
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
} from '../src/system-shared'
import { SystemWide } from '../src/desktop/SystemWide'
export { PageError as ErrorBoundary } from '../src/components/PageError'

// 回答"这些信息靠得住吗"（design.md 8.3）：顶部一行"一切正常 / 有 N 个问题"，点开看细节；
// 下面是 7 天指标和常用动作，设置、反馈、全部动态、版本收进"更多"
export default function SystemScreen() {
  const wide = useWide()
  return wide && desktop ? <SystemWide /> : <SystemPhone />
}

function SystemPhone() {
  const view = useHub<SourcesList>('/sources')
  const auth = useHub<AuthList>('/auth-status')
  useViewTracking('system')
  const { config } = useConfig()
  const router = useRouter()
  const wide = useWide()
  const [detail, setDetail] = useState(false)
  const problems = problemsOf(config.hub !== null, view.error !== null, view.data, auth.data)

  return (
    <Screen
      view={view}
      // 宽屏里系统是一级页：顶栏写页名，不显示返回，页面里也不再重复大标题（docs/desktop-v2.md #15）
      head={wide ? { kind: 'title', title: t('系统') } : { kind: 'back', label: t('返回') }}
      top={
        <>
          {wide ? null : <Text style={styles.title}>{t('系统')}</Text>}
          <StatusLine problems={problems} open={detail} onToggle={() => setDetail(!detail)} />
          <Card style={styles.notifyRow} onPress={() => router.push('/notify')}>
            <Bell size={16} color={colors.tx2} strokeWidth={1.8} />
            <Text style={styles.notifyText}>{t('通知')}</Text>
            <Text style={styles.small}>{t('按类型开关推送')}</Text>
            <View style={{ flex: 1 }} />
            <ChevronRight size={16} color={colors.tx2} />
          </Card>
          {detail ? (
            <>
              <RunBlock view={view} />
              <SourcesBlock sources={view.data} />
              <AuthBlock view={auth} />
            </>
          ) : null}
          <MetricsBlock />
          <RefreshBlock />
          <ReviewNowBlock />
          {pwa === null ? <OrcaBlock /> : null}
        </>
      }
      footer={<MoreBlock startOpen={config.hub === null} />}
    >
      {() => null}
    </Screen>
  )
}

function StatusLine({ problems, open, onToggle }: { problems: Problem[] | null; open: boolean; onToggle: () => void }) {
  const tone = problems === null ? colors.tx2 : problems.length === 0 ? colors.ok : problems.some((p) => p.bad) ? colors.bad : colors.warn
  const label = problems === null ? t('检查中…') : problems.length === 0 ? t('一切正常') : t('有 {n} 个问题', { n: problems.length })
  return (
    <Card onPress={onToggle} style={styles.status}>
      <View style={styles.statusRow}>
        <View style={[styles.statusLed, { backgroundColor: tone }]} />
        <Text style={[styles.statusText, { color: problems === null || problems.length === 0 ? colors.tx : tone }]}>{label}</Text>
        <Text style={styles.small}>{open ? t('收起') : t('细节')}</Text>
        {open ? <ChevronUp size={16} color={colors.tx2} /> : <ChevronDown size={16} color={colors.tx2} />}
      </View>
      {problems === null || problems.length === 0 ? null : <Text style={styles.statusList}>{problems.map((p) => p.text).join(t('、'))}</Text>}
    </Card>
  )
}

// 细节 · 运行：hub、两个 agent（排队/运行数）、维护会话、上次同步
function RunBlock({ view }: { view: HubView<SourcesList> }) {
  const { config } = useConfig()
  const [lastSync, setLastSync] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      readLastSync().then(setLastSync)
    }, [view.fetchedAt]),
  )
  const queued = useHub<JobsList>('/jobs?status=queued')
  const running = useHub<JobsList>('/jobs?status=running')
  const count = (list: JobsList | null, runner: Runner) => (list === null ? null : list.jobs.filter((j) => j.runner === runner).length)
  const hubOk = view.error === null && view.live
  const hubState = config.hub === null ? t('未设置') : hubOk ? t('正常') : view.error === null ? t('连接中') : t('连不上')
  return (
    <Section title={t('运行')}>
      <Card>
        <View style={styles.src}>
          <View style={[styles.led, { backgroundColor: hubOk ? colors.ok : colors.bad }]} />
          <View style={styles.nm}>
            <Text style={styles.name}>Hub</Text>
            <Text style={styles.small}>{config.hub === null ? t('去"更多"里填地址和令牌') : config.hub.hubUrl}</Text>
          </View>
          <Text style={styles.tm}>{hubState}</Text>
        </View>
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
          const led = src === undefined ? colors.tx2 : !src.alive ? colors.bad : q !== null && q > 0 && r === 0 ? colors.warn : colors.ok
          return (
            <View key={a.runner} style={[styles.src, styles.divided]}>
              <View style={[styles.led, { backgroundColor: led }]} />
              <View style={styles.nm}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={[styles.small, src !== undefined && !src.alive && { color: colors.bad }]}>
                  {src === undefined
                    ? `${a.note} · ${t('未登记')}`
                    : src.last_seen_at === null
                      ? `${a.note} · ${t('从未心跳')}`
                      : `${a.note} · ${t('心跳 {ago}', { ago: ago(src.last_seen_at) })}`}
                </Text>
              </View>
              <Text style={styles.tm}>{load}</Text>
            </View>
          )
        })}
        <MaintainerRow source={view.data === null ? undefined : view.data.sources.find((x) => x.name === MAINTAINER)} />
      </Card>
      <Text style={styles.queue}>
        {t('上次同步 {when}', { when: lastSync === null ? t('从未') : `${when(lastSync)} (${ago(lastSync)})` })}
      </Text>
    </Section>
  )
}

function SourcesBlock({ sources: data }: { sources: SourcesList | null }) {
  if (data === null) return null
  const sources = data.sources.filter((x) => !AGENT_SOURCES.has(x.name))
  return (
    <Section title={t('数据源')} right={t('上次收到')}>
      {sources.length === 0 ? (
        <Empty text={t('还没有数据源登记')} />
      ) : (
        <Card>
          <Rows>
            {sources.map((s) => (
              <SourceRow key={s.name} source={s} />
            ))}
          </Rows>
        </Card>
      )}
    </Section>
  )
}

// 更多：反馈与建议、全部动态、显示、早晚通知、连接设置、版本。没填 hub 时默认展开
function MoreBlock({ startOpen }: { startOpen: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <Pressable style={styles.moreHead} onPress={() => setOpen(!open)} hitSlop={6}>
        <Text style={styles.moreText}>{t('更多')}</Text>
        <Text style={styles.small}>{t('设置、反馈、全部动态、版本')}</Text>
        <View style={{ flex: 1 }} />
        {open ? <ChevronUp size={16} color={colors.tx2} /> : <ChevronDown size={16} color={colors.tx2} />}
      </Pressable>
      {open ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Btn label={t('反馈与建议')} icon={MessageSquareWarning} onPress={() => router.push('/feedback')} />
            <Btn label={t('全部动态')} icon={ListIcon} onPress={() => router.push('/feed')} />
          </View>
          <DisplayBlock />
          <NotifyBlock />
          {tauri === null ? null : <AutostartBlock api={tauri} />}
          {pwa === null ? <Settings /> : <PwaSettings />}
          <VersionBlock />
        </>
      ) : null}
    </>
  )
}

// 检验指标（design.md 0.1）：最近 7 天每天打开几次、晚上问了有没有回
function MetricsBlock() {
  const today = todayYmd()
  const from = addDays(today, -6)
  const view = useHub<Metrics>(`/metrics?from=${from}&to=${today}`)
  if (view.data === null) return view.error === null ? null : <Empty text={t('读不到指标：{error}', { error: humanize(view.error).message })} />
  const { days, totals } = view.data
  return (
    <Section title={t('最近 7 天')}
      right={t('打开 {opens} 次 · 晚间回复 {replied}/{asked}', { opens: totals.opens, replied: totals.evening_replied, asked: totals.evening_asked })}>
      <Card style={styles.metrics}>
        {days.map((d) => (
          <View key={d.date} style={styles.metricCol}>
            <Text style={styles.metricNum}>{d.opens}</Text>
            <Text style={[styles.metricReply, d.evening_asked > 0 && d.evening_replied === 0 && { color: colors.warn }]}>
              {d.evening_asked === 0 ? '—' : d.evening_replied > 0 ? t('回了') : t('没回')}
            </Text>
            <Text style={styles.metricDate}>{t('{day}日', { day: Number(d.date.slice(8)) })}</Text>
          </View>
        ))}
      </Card>
      {desktop ? null : <Text style={styles.queue}>{t('上面是每天打开次数，下面是晚间提问有没有回')}</Text>}
    </Section>
  )
}

function MaintainerRow({ source: s }: { source: Source | undefined }) {
  const led = s === undefined ? colors.tx2 : s.alive ? colors.ok : colors.bad
  return (
    <View style={[styles.src, styles.divided]}>
      <View style={[styles.led, { backgroundColor: led }]} />
      <View style={styles.nm}>
        <Text style={styles.name}>{t('维护会话')}</Text>
        <Text style={[styles.small, s !== undefined && !s.alive && { color: colors.bad }]}>
          {s === undefined
            ? t('还没报过心跳')
            : s.last_seen_at === null
              ? t('从未心跳')
              : s.alive
                ? t('心跳 {ago} · 处理反馈、修问题', { ago: ago(s.last_seen_at) })
                : t('{ago}起没心跳，Mac 会开新会话接班', { ago: ago(s.last_seen_at) })}
        </Text>
      </View>
      <Text style={styles.tm}>{s === undefined ? '…' : s.alive ? t('在线') : t('失联')}</Text>
    </View>
  )
}

// 心跳（活着没）和结果健康（产出对不对）分开：失联或 error 红，warn 黄，都写原因
function SourceRow({ source: s }: { source: Source }) {
  const bad = !s.alive || s.health === 'error'
  const led = bad ? colors.bad : s.health === 'warn' ? colors.warn : colors.ok
  return (
    <View style={styles.src}>
      <View style={[styles.led, { backgroundColor: led }]} />
      <View style={styles.nm}>
        <Text style={styles.name}>{s.name}</Text>
        <Text style={[styles.small, !s.alive && { color: colors.bad }]}>
          {s.alive ? t('应每 {interval} 一次', { interval: interval(s.expected_interval_s) }) : t('超过 {interval} 没心跳', { interval: interval(s.expected_interval_s) })}
        </Text>
        {s.health === null || s.health === 'ok' ? null : (
          <Text style={[styles.small, { color: s.health === 'error' ? colors.bad : colors.warn }]}>
            {s.health === 'error' ? t('出错') : t('需要留意')}
            {s.health_detail === null ? '' : t('：{detail}', { detail: s.health_detail })}
            {s.health_at === null ? '' : t('（{ago}）', { ago: ago(s.health_at) })}
          </Text>
        )}
      </View>
      <Text style={styles.tm}>{s.last_seen_at === null ? t('从未') : ago(s.last_seen_at)}</Text>
    </View>
  )
}

// Mac app 开机自启（desktop 的 autostart 插件；首次启动 desktop 默认打开）
function AutostartBlock({ api }: { api: TauriApi }) {
  const { on, toggle } = useAutostart(api)
  return (
    <Section title="Mac app">
      <Card style={styles.autostart}>
        <Text style={styles.autostartText}>{t('开机自动打开 Mojito')}</Text>
        {on === null ? <ActivityIndicator color={colors.tx2} /> : <Toggle value={on} onChange={toggle} disabled={false} />}
      </Card>
    </Section>
  )
}

// 早晚通知：GET/PUT /settings，三个字段一起提交
function NotifyBlock() {
  const view = useHub<NotifySettings>('/settings')
  return (
    <Section title={t('早晚通知')} right={t('本地时间')}>
      {view.data === null ? (
        <Empty text={view.error === null ? t('读取中…') : t('读不到设置：{error}', { error: humanize(view.error).message })} />
      ) : (
        <NotifyForm key={JSON.stringify(view.data)} current={view.data} onSaved={view.refresh} />
      )}
    </Section>
  )
}

function NotifyForm({ current, onSaved }: { current: NotifySettings; onSaved: () => Promise<void> }) {
  const { morning, setMorning, evening, setEvening, eveningOn, setEveningOn, busy, valid, changed, save } = useNotifyForm(current, onSaved)
  return (
    <Card style={styles.form}>
      <View style={styles.timeRow}>
        <View style={styles.timeCol}>
          <Text style={styles.label}>{t('早上简报')}</Text>
          <TextInput
            style={styles.input}
            value={morning}
            onChangeText={setMorning}
            placeholder="08:00"
            placeholderTextColor={colors.tx2}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
        <View style={styles.timeCol}>
          <Text style={styles.label}>{t('晚上提问')}</Text>
          <TextInput
            style={[styles.input, !eveningOn && { opacity: 0.4 }]}
            value={evening}
            onChangeText={setEvening}
            placeholder="21:00"
            placeholderTextColor={colors.tx2}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            editable={eveningOn}
          />
        </View>
      </View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{t('晚间提问')}</Text>
          <Text style={styles.small}>{t('"今天推进了什么？"，当天记过就不问')}</Text>
        </View>
        {desktop ? (
          <Toggle value={eveningOn} onChange={setEveningOn} disabled={false} />
        ) : (
          <Switch value={eveningOn} onValueChange={setEveningOn} trackColor={{ true: colors.brand, false: colors.raised }} />
        )}
      </View>
      {valid ? null : <Text style={[styles.small, { color: colors.bad }]}>{t('时间格式是 HH:MM，比如 08:00')}</Text>}
      <View style={{ flexDirection: 'row' }}>
        <Btn label={t('保存')} primary disabled={busy || !valid || !changed} onPress={save} />
      </View>
    </Card>
  )
}

// 外部授权：Google 和 Claude 的令牌失效时在这里标红，并写明怎么修
function AuthBlock({ view }: { view: HubView<AuthList> }) {
  return (
    <Section title={t('授权')} right={t('上次检查')}>
      {view.data === null ? (
        <Empty text={view.error === null ? t('读取中…') : t('读不到授权状态：{error}', { error: humanize(view.error).message })} />
      ) : view.data.auth.length === 0 ? (
        <Empty text={t('还没有检查记录')} />
      ) : (
        <Card>
          <Rows>
            {view.data.auth.map((a) => (
              <View key={a.name} style={styles.src}>
                <View style={[styles.led, { backgroundColor: a.ok ? colors.ok : colors.bad }]} />
                <View style={styles.nm}>
                  <Text style={styles.name}>{a.name in AUTH_LABEL ? AUTH_LABEL[a.name] : a.name}</Text>
                  {a.ok ? null : (
                    <>
                      <Text style={[styles.small, { color: colors.bad }]}>
                        {t('失效')}
                        {a.detail === null ? '' : t('：{detail}', { detail: a.detail })}
                      </Text>
                      <Text style={styles.small}>{t('怎么修：{fix}', { fix: a.name.startsWith('claude') ? FIX_CLAUDE : FIX_GOOGLE })}</Text>
                    </>
                  )}
                </View>
                <Text style={styles.tm}>{ago(a.checked_at)}</Text>
              </View>
            ))}
          </Rows>
        </Card>
      )}
    </Section>
  )
}

function RefreshBlock() {
  const { job, start } = useRefresh()
  const pending = job !== null && (job.status === 'queued' || job.status === 'running')
  return (
    <View style={styles.block}>
      <Pressable style={({ pressed }) => [styles.refresh, (pressed || pending) && { opacity: 0.7 }]} disabled={pending} onPress={start}>
        {pending ? (
          <ActivityIndicator size="small" color={colors.onBrand} />
        ) : (
          <RefreshCw size={16} color={colors.onBrand} strokeWidth={2} />
        )}
        <Text style={styles.refreshText}>{pending ? jobStatus[job.status] : t('刷新全部')}</Text>
      </Pressable>
      <Text style={styles.queue}>
        {job === null
          ? t('还没刷新过')
          : t('上次刷新 {when} · {status}', { when: job.requested_at === null ? '' : when(job.requested_at), status: jobStatus[job.status] }) +
            (job.error === null ? '' : t('：{detail}', { detail: job.error }))}
        {' · '}
        {t('Mac 睡着时会排队，醒来执行')}
      </Text>
    </View>
  )
}

// 显示：字号（在安卓系统字体大小之上再放大）和深浅色。都在样式创建时定下，选了之后重载一次生效
function DisplayBlock() {
  const pickLanguage = usePickLanguage()
  return (
    <Section title={t('显示')}>
      <Card style={styles.form}>
        <Text style={styles.label}>{t('字号')}</Text>
        <View style={styles.chipRow}>
          {SCALES.map(([k, label]) => (
            <Filter key={k} label={label} on={fontScaleName === k} onPress={() => pickScale(k)} />
          ))}
        </View>
        <Text style={styles.label}>{t('深浅色')}</Text>
        <View style={styles.chipRow}>
          {SCHEMES.map(([k, label]) => (
            <Filter key={k} label={label} on={colorSchemeSetting === k} onPress={() => pickScheme(k)} />
          ))}
        </View>
        <Text style={styles.label}>{t('语言')}</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map(([k, label]) => (
            <Filter key={k} label={label} on={language === k} onPress={() => pickLanguage(k)} />
          ))}
        </View>
        <Text style={styles.hint}>
          {pwa === null ? t('选了之后 app 会重新加载一下。字号还会跟随手机系统的字体大小。') : t('选了之后 app 会重新加载一下。网页版不跟随系统字号。')}
        </Text>
      </Card>
    </Section>
  )
}

function ReviewNowBlock() {
  const { busy, start } = useStartReview()
  return (
    <View style={styles.block}>
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <Btn label={t('现在复盘')} icon={NotebookText} disabled={busy} onPress={start} />
      </View>
      <Text style={styles.queue}>{t('平时在计划结束当晚自动复盘；想提前就点这里')}</Text>
    </View>
  )
}

function OrcaBlock() {
  const open = useOpenOrca()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
      <Btn label={t('去 Orca')} icon={ExternalLink} onPress={open} />
    </View>
  )
}

// 当前运行的 JS 包：空中更新的 updateId / 创建时间，或 APK 内置包；用来确认手机上是哪个版本
function VersionBlock() {
  const lines = versionLines()
  return (
    <View style={styles.version}>
      {lines.map((l) => (
        <Text key={l} style={styles.versionText} selectable>
          {l}
        </Text>
      ))}
    </View>
  )
}

function Settings() {
  const { hubUrl, setHubUrl, token, setToken, orcaUrl, setOrcaUrl, save } = useConnectionForm()

  return (
    <Section title={t('连接设置')}>
      <Card style={styles.form}>
        <Text style={styles.label}>{t('hub 地址')}</Text>
        <TextInput
          style={styles.input}
          value={hubUrl}
          onChangeText={setHubUrl}
          placeholder="https://hub.example.com"
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.label}>{t('app 令牌')}</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder={t('Bearer 令牌')}
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.label}>{t('Orca 链接（"去 Orca"打开它，一般填 orca://）')}</Text>
        <TextInput
          style={styles.input}
          value={orcaUrl}
          onChangeText={setOrcaUrl}
          placeholder="orca://"
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>{t('令牌只存在本机安全存储里，不打进安装包。')}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Btn label={t('保存')} primary onPress={save} />
        </View>
      </Card>
    </Section>
  )
}

const styles = StyleSheet.create({
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 13 },
  notifyText: { ...font.medium, fontSize: size.body, color: colors.tx },
  autostart: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 13 },
  autostartText: { ...font.regular, fontSize: size.body, color: colors.tx },
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  status: { paddingVertical: 12, paddingHorizontal: 13, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLed: { width: 10, height: 10, borderRadius: 5 },
  statusText: { ...font.semibold, fontSize: size.title, flex: 1 },
  statusList: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  moreHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  moreText: { ...font.semibold, fontSize: size.body, color: colors.tx },
  src: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13 },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8 },
  metricCol: { alignItems: 'center', gap: 2, flex: 1 },
  metricNum: { ...font.mono, fontSize: size.title, color: colors.tx },
  metricReply: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  metricDate: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  divided: { borderTopWidth: 1, borderTopColor: colors.line },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeCol: { flex: 1, gap: 5 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  led: { width: 7, height: 7, borderRadius: 4 },
  nm: { flex: 1 },
  name: { ...font.regular, fontSize: size.body, color: colors.tx },
  small: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  tm: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'right' },
  block: { gap: 8 },
  // 电脑上是居中的小按钮，不铺满整行（design.md 8.4 用户反馈修订）
  refresh: desktop
    ? {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: colors.brand,
      }
    : {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors.brand,
      },
  refreshText: { ...font.semibold, fontSize: desktop ? size.secondary : size.title, color: colors.onBrand },
  queue: { ...font.regular, fontSize: size.secondary, color: colors.tx2, textAlign: 'center' },
  form: { padding: 13, gap: 7 },
  label: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  input: {
    ...font.regular,
    backgroundColor: colors.raised,
    color: colors.tx,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: size.body,
  },
  version: { alignItems: 'center', gap: 2, marginTop: 4 },
  versionText: { ...font.mono, fontSize: size.small, color: colors.tx2, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  hint: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
