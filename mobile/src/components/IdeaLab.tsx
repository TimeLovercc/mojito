import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react-native'
import { hubRequest } from '../api/client'
import type { IdeaLabData, LabIdea, LabMode, LabRunSpec, LabSeed } from '../api/idea-lab'
import { useConfig } from '../config/context'
import { t } from '../i18n'
import { colors, font, isDark, overlay, size } from '../theme'
import { when } from '../time'
import { useHub } from '../use-hub'
import { StaleBanner } from './Screen'

const ideaLabels = { developing: '正在发展', ready: '待验证', experimenting: '实验中', supported: '有证据支持', contradicted: '存在矛盾', archived: '已归档' }
const ideaColors = { developing: isDark ? '#8bacd5' : '#406d9f', ready: isDark ? '#d5b16e' : '#886116', experimenting: isDark ? '#b7a1d6' : '#78559d', supported: isDark ? '#80bdb8' : '#357873', contradicted: isDark ? '#d89494' : '#a14949', archived: colors.tx3 }
const runLabels = { queued: '排队中', running: '运行中', completed: '本轮完成', needs_input: '需要补充条件', failed: '运行失败', cancelled: '已取消' }
const modeLabels: Record<LabMode, string> = { explore: '探索问题', develop: '发展想法', experiment: '实验验证', write: '论文写作', review: '独立核查', cycle: '完整研究循环' }
const newKey = () => `research-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function LabButton({ children, onPress, selected, disabled }: { children: ReactNode; onPress: () => void; selected?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ selected, disabled }}
    {...(Platform.OS === 'web' && selected !== undefined ? { 'aria-pressed': selected } : {})}
    onPress={onPress} style={[s.button, selected === true && s.selected, disabled === true && s.disabled]}>
    <Text style={s.buttonText}>{children}</Text>
  </Pressable>
}
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <View style={s.fold}><Pressable accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.foldHead}>
    {open ? <ChevronDown size={15} color={colors.tx2} /> : <ChevronRight size={15} color={colors.tx2} />}<Text style={s.label}>{title}</Text>
  </Pressable>{open ? <View style={s.foldBody}>{children}</View> : null}</View>
}
export function LabLink({ value, title }: { value: string; title: string }) {
  const [error, setError] = useState<string | null>(null)
  const open = async () => { try { if (/^https?:\/\//.test(value)) await Linking.openURL(value); else await Clipboard.setStringAsync(value) } catch (e) { if (!(e instanceof Error)) throw e; setError(e.message) } }
  return <View><LabButton onPress={() => { void open() }}>{title}{/^https?:\/\//.test(value) ? ' ↗' : ` · ${t('复制路径')}`}</LabButton>{error === null ? null : <Text style={s.error}>{error}</Text>}</View>
}
function Field({ label, value, onChange, numeric }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return <View style={s.stack}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
    multiline={!numeric} keyboardType={numeric ? 'number-pad' : 'default'} style={[s.input, !numeric && s.multiline]} placeholderTextColor={colors.tx3} /></View>
}

export function IdeaLab({ initialIdea, initialSeed }: { initialIdea: string | null; initialSeed: string | null }) {
  const view = useHub<IdeaLabData>('/idea-lab')
  const { config } = useConfig()
  const [selected, setSelected] = useState<string | null>(initialIdea)
  const [form, setForm] = useState(initialSeed !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  useEffect(() => { const timer = setInterval(() => { void view.refresh() }, 10000); return () => clearInterval(timer) }, [view.refresh])
  const mutate = async (path: string, body: object, method: 'POST' | 'PUT') => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { if (config.hub === null) throw new Error(t('请先连接 hub')); await hubRequest(config.hub, method, path, body); await view.refresh() }
    catch (e) { if (!(e instanceof Error)) throw e; setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const data = view.data
  const idea = data === null || selected === null ? undefined : data.ideas.find(i => i.id === selected)
  return <View style={s.stack}>
    <View style={s.headingRow}><FlaskConical color={colors.brand} size={23} /><Text style={s.heading}>Idea Lab</Text></View>
    <Text style={s.muted}>{t('从材料发展问题，让证据决定下一步。')}</Text>
    <StaleBanner view={view} />{view.error === null ? null : <LabButton onPress={() => { void view.refresh() }}>{t('重试')}</LabButton>}
    {error === null ? null : <Text style={s.error}>{error}</Text>}
    {data === null ? (view.error === null ? <ActivityIndicator color={colors.brand} /> : null) : <>
      <View style={s.row}><LabButton selected={form} onPress={() => setForm(!form)}>{form ? t('收起运行设置') : t('开始研究')}</LabButton>
        {selected === null ? null : <LabButton onPress={() => { setSelected(null); setForm(false) }}>{t('返回想法列表')}</LabButton>}</View>
      {form ? <RunForm key={`${selected}:${initialSeed}`} data={data} ideaId={selected} seedId={initialSeed} onDone={() => { setForm(false); void view.refresh() }} /> : null}
      {selected !== null && idea === undefined ? <Text style={s.muted}>{t('此想法不在当前记录中，请刷新或返回列表。')}</Text> : null}
      {idea === undefined ? <>
        {data.ideas.length === 0 ? <View style={s.card}><Text style={s.title}>{t('还没有发展中的问题')}</Text><Text style={s.muted}>{t('选择收件箱材料和研究方向，开始一轮探索。')}</Text></View> : null}
        {(['developing', 'ready', 'experimenting', 'supported', 'contradicted', 'archived'] as const).map(status => {
          const items = data.ideas.filter(i => i.status === status)
          return items.length === 0 ? null : <View key={status} style={s.stack}><Text style={[s.section, { color: ideaColors[status] }]}>{t(ideaLabels[status])} · {items.length}</Text>
            {items.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => setSelected(item.id)} style={[s.card, { borderLeftWidth: 3, borderLeftColor: ideaColors[status] }]}>
              <Text style={s.title} numberOfLines={2}>{item.question}</Text>
              <Text style={s.muted} numberOfLines={1}>{item.importance}</Text>
              <Text style={s.body} numberOfLines={2}>{item.evidence.length === 0 ? t('尚无验证证据') : item.evidence[item.evidence.length - 1].claim}</Text>
              <Text style={s.next} numberOfLines={2}>{t('下一步：{step}', { step: item.next_step })}</Text>
            </Pressable>)}
          </View>
        })}
      </> : <IdeaDetail idea={idea} seeds={data.seeds} />}
      <Fold title={`${t('研究运行')} · ${data.runs.length}`}>
        {data.runs.length === 0 ? <Text style={s.muted}>{t('还没有运行记录')}</Text> : data.runs.map(run => <View key={run.id} style={s.card}>
          <Text style={s.title}>{run.title}</Text><Text style={s.meta}>{t(runLabels[run.status])} · {when(run.created_at)}</Text>
          <Text style={s.body}>{run.summary === '' ? run.goal : run.summary}</Text>
          <Text style={s.meta}>{t('本轮预算：{minutes} 分钟 · 最多 {turns} 轮', { minutes: run.budget.wall_minutes, turns: run.budget.max_turns })}</Text>
          {run.error === null ? null : <Text style={s.error}>{run.error}</Text>}
          {run.output_idea_ids.map(id => <LabButton key={id} onPress={() => setSelected(id)}>{data.ideas.find(i => i.id === id)?.title ?? id}</LabButton>)}
          {run.artifacts.map(a => <LabLink key={a.url} value={a.url} title={a.title} />)}
          {run.status === 'running' || run.status === 'queued' ? <LabButton disabled={busy} onPress={() => { void mutate(`/idea-lab/runs/${run.id}/cancel`, {}, 'POST') }}>{t('取消本轮')}</LabButton> : null}
        </View>)}
      </Fold>
      <Fold title={`${t('持续探索')} · ${data.automations.length}`}>
        {data.automations.length === 0 ? <Text style={s.muted}>{t('尚未启用持续探索；可在运行设置中明确次数与间隔。')}</Text> : data.automations.map(a => <View key={a.id} style={s.card}>
          <Text style={s.title}>{a.title}</Text><Text style={s.meta}>{a.state === 'exhausted' ? t('授权次数已用完') : a.enabled ? t('已启用') : t('已停用')} · {a.runs_started}/{a.max_runs}</Text>
          <Text style={s.muted}>{a.trigger === 'new_seed' ? t('新材料触发') : t('按间隔运行')} · {a.interval_minutes} {t('分钟')}</Text>
          {a.enabled ? <Text style={s.meta}>{t('下次检查：{at}', { at: when(a.next_at) })}</Text> : null}
          {a.state === 'exhausted' ? null : <LabButton disabled={busy} onPress={() => { void mutate(`/idea-lab/automations/${a.id}`, { enabled: !a.enabled }, 'PUT') }}>{a.enabled ? t('停用计划') : t('启用计划')}</LabButton>}
          <Text style={s.meta}>{t('停用计划阻止后续轮次；已开始的运行可单独取消。')}</Text>
        </View>)}
      </Fold>
    </>}
  </View>
}

function IdeaDetail({ idea, seeds }: { idea: LabIdea; seeds: LabSeed[] }) {
  return <View style={s.stack}>
    <Text style={s.title}>{idea.title}</Text><Text style={[s.meta, { color: ideaColors[idea.status] }]}>{t(ideaLabels[idea.status])} · {when(idea.updated_at)}</Text>
    <Text style={s.question}>{idea.question}</Text><Text style={s.body}>{idea.importance}</Text>
    <View style={s.card}><Text style={s.label}>{t('下一步')}</Text><Text style={s.next}>{idea.next_step}</Text></View>
    {idea.notion_sync === 'pending' ? <Text style={s.muted}>{t('研究正文待同步到 Notion；这里显示当前摘要。')}</Text> : null}
    {idea.notion_url === null ? null : <LabLink value={idea.notion_url} title={t('打开研究正文')} />}
    <Fold title={`${t('来源材料')} · ${idea.seed_ids.length}`}>{idea.seed_ids.map(id => {
      const seed = seeds.find(s => s.id === id)
      return <View key={id} style={s.card}><Text style={s.body}>{seed === undefined ? id : seed.text}</Text>{seed === undefined ? null : <><Text style={s.muted}>{seed.reason}</Text><LabLink value={seed.source} title={t('原始来源')} /></>}</View>
    })}</Fold>
    <Fold title={`${t('假设与竞争解释')} · ${idea.hypotheses.length}`}>{idea.hypotheses.map((h, i) => <Text key={i} style={s.body}>{i + 1}. {h}</Text>)}</Fold>
    <Fold title={`${t('证据记录')} · ${idea.evidence.length}`}>{idea.evidence.map(e => <View key={e.id} style={s.card}><Text style={s.body}>{e.claim}</Text><Text style={s.meta}>{when(e.at)} · {e.kind}</Text><LabLink value={e.source} title={t('查看证据')} /></View>)}</Fold>
    <Text style={s.section}>{t('判断如何变化')}</Text>
    {idea.changes.length === 0 ? <Text style={s.muted}>{t('尚未记录判断变化')}</Text> : [...idea.changes].reverse().map((c, i) => <View key={i} style={s.card}>
      <Text style={s.meta}>{when(c.at)}</Text><Text style={s.muted}>{t('之前：{value}', { value: c.before })}</Text><Text style={s.body}>{t('现在：{value}', { value: c.after })}</Text><Text style={s.next}>{c.reason}</Text>
    </View>)}
    <Fold title={`${t('实验与文稿')} · ${idea.artifacts.length}`}>{idea.artifacts.map(a => <LabLink key={a.url} value={a.url} title={a.title} />)}</Fold>
  </View>
}

function RunForm({ data, ideaId, seedId, onDone }: { data: IdeaLabData; ideaId: string | null; seedId: string | null; onDone: () => void }) {
  const { config } = useConfig()
  const [mode, setMode] = useState<LabMode>('explore')
  const [title, setTitle] = useState(''), [goal, setGoal] = useState(''), [direction, setDirection] = useState('')
  const [minutes, setMinutes] = useState(''), [turns, setTurns] = useState(''), [policy, setPolicy] = useState('')
  const [allowCpu, setAllowCpu] = useState(false), [allowWrite, setAllowWrite] = useState(false)
  const [seeds, setSeeds] = useState<string[]>(seedId === null ? [] : [seedId])
  const [repeat, setRepeat] = useState(false), [trigger, setTrigger] = useState<'interval' | 'new_seed'>('interval')
  const [interval, setIntervalText] = useState(''), [count, setCount] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const key = useRef(newKey()), lock = useRef(false)
  const number = (value: string, label: string, max: number, min: number) => { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error(t('{label}须为 {min}–{max} 的整数', { label, min, max })); return n }
  const submit = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      if (config.hub === null) throw new Error(t('请先连接 hub'))
      if (allowCpu && !allowWrite) throw new Error(t('CPU 分析需要同时允许保存研究产物'))
      if (title.trim() === '' || goal.trim() === '' || direction.trim() === '') throw new Error(t('请填写名称、方向和本轮目标'))
      const run: LabRunSpec = { title: title.trim(), goal: goal.trim(), direction: direction.trim(), mode, seed_ids: seeds, idea_ids: ideaId === null ? [] : [ideaId], budget: { wall_minutes: number(minutes, t('时间预算'), 120, 1), max_turns: number(turns, t('调用轮数'), 100, 1), allow_cpu: allowCpu, allow_write: allowWrite }, experiment_policy: policy }
      if (repeat) await hubRequest(config.hub, 'POST', '/idea-lab/automations', { idempotency_key: key.current, title: run.title, enabled: true, trigger, interval_minutes: number(interval, t('间隔分钟'), 43200, 5), max_runs: number(count, t('总轮数'), 100, 1), run })
      else await hubRequest(config.hub, 'POST', '/idea-lab/runs', { idempotency_key: key.current, ...run })
      onDone()
    } catch (e) { if (!(e instanceof Error)) throw e; setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <View style={s.form}>
    <Text style={s.section}>{t('本轮研究授权')}</Text>
    <Text style={s.muted}>{t('选择重要方向与材料；预算内自主推进，新增预算和正式立项另行决定。')}</Text>
    <Field label={t('运行名称（英文）')} value={title} onChange={setTitle} />
    <Field label={t('重要方向与研究偏好')} value={direction} onChange={setDirection} />
    <Field label={t('本轮目标')} value={goal} onChange={setGoal} />
    <View style={s.row}>{(Object.keys(modeLabels) as LabMode[]).map(m => <LabButton key={m} selected={mode === m} onPress={() => setMode(m)}>{t(modeLabels[m])}</LabButton>)}</View>
    <Fold title={`${t('选择种子')} · ${seeds.length}`}>
      {data.seeds.filter(s => s.present).map(seed => <LabButton key={seed.id} selected={seeds.includes(seed.id)} onPress={() => setSeeds(seeds.includes(seed.id) ? seeds.filter(id => id !== seed.id) : [...seeds, seed.id])}>{seed.text}</LabButton>)}
    </Fold>
    <Field label={t('时间预算（分钟，1–120）')} value={minutes} onChange={setMinutes} numeric />
    <Field label={t('最大调用轮数（1–100）')} value={turns} onChange={setTurns} numeric />
    <View style={s.row}><LabButton selected={allowCpu} onPress={() => setAllowCpu(!allowCpu)}>{t('允许 CPU 数据分析')}</LabButton><LabButton selected={allowWrite} onPress={() => setAllowWrite(!allowWrite)}>{t('允许写研究产物')}</LabButton></View>
    <Field label={t('实验范围与限制')} value={policy} onChange={setPolicy} />
    <Text style={s.meta}>{t('时间与轮数有硬限制。Mac 不运行模型；GPU 须有现有资源分配，不新增付费 API 或自动投稿。')}</Text>
    <LabButton selected={repeat} onPress={() => setRepeat(!repeat)}>{t('启用有界持续探索')}</LabButton>
    {repeat ? <View style={s.stack}>
      <View style={s.row}><LabButton selected={trigger === 'interval'} onPress={() => setTrigger('interval')}>{t('按间隔运行')}</LabButton><LabButton selected={trigger === 'new_seed'} onPress={() => setTrigger('new_seed')}>{t('新材料触发')}</LabButton></View>
      <Field label={t('间隔分钟（至少 5）')} value={interval} onChange={setIntervalText} numeric />
      <Field label={t('授权总轮数（1–100）')} value={count} onChange={setCount} numeric />
      <Text style={s.meta}>{t('后续轮次延续本计划产出的想法，使用相同预算；达到总轮数后停止调度。')}</Text>
    </View> : null}
    {error === null ? null : <Text style={s.error}>{error}</Text>}
    <LabButton disabled={busy} onPress={() => { void submit() }}>{busy ? t('正在提交') : repeat ? t('保存并启用计划') : t('启动本轮')}</LabButton>
  </View>
}

export function SeedConnections({ seed, data, onIdea, onExplore, onRefresh }: { seed: LabSeed; data: IdeaLabData; onIdea: (id: string) => void; onExplore: (id: string) => void; onRefresh: () => Promise<void> }) {
  const { config } = useConfig()
  const [reason, setReason] = useState(seed.reason), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const save = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { if (config.hub === null) throw new Error(t('请先连接 hub')); await hubRequest(config.hub, 'PUT', `/idea-lab/seeds/${seed.id}`, { reason }); await onRefresh() }
    catch (e) { if (!(e instanceof Error)) throw e; setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <View style={s.stack}>
    <Text style={s.meta}>{t('关联 {n} 个想法', { n: seed.idea_ids.length })}{seed.last_explored_at === null ? '' : ` · ${t('最近探索：{at}', { at: when(seed.last_explored_at) })}`}</Text>
    {seed.idea_ids.map(id => <LabButton key={id} onPress={() => onIdea(id)}>{data.ideas.find(i => i.id === id)?.title ?? id}</LabButton>)}
    <Field label={t('为什么收集这条材料')} value={reason} onChange={setReason} />
    {error === null ? null : <Text style={s.error}>{error}</Text>}
    <View style={s.row}><LabButton disabled={busy || reason === seed.reason} onPress={() => { void save() }}>{t('保存备注')}</LabButton><LabButton onPress={() => onExplore(seed.id)}>{t('从这条材料探索')}</LabButton></View>
  </View>
}

const s = StyleSheet.create({
  stack: { gap: 12, minWidth: 0 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, heading: { ...font.semibold, fontSize: size.page, color: colors.tx },
  section: { ...font.semibold, fontSize: size.title, color: colors.tx, marginTop: 8 }, title: { ...font.semibold, fontSize: size.body, color: colors.tx, lineHeight: size.body * 1.5 },
  question: { ...font.medium, fontSize: size.title, color: colors.tx, lineHeight: size.title * 1.5 }, label: { ...font.medium, fontSize: size.secondary, color: colors.tx2 },
  body: { ...font.regular, fontSize: size.body, color: colors.tx, lineHeight: size.body * 1.6, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}) },
  muted: { ...font.regular, fontSize: size.secondary, color: colors.tx2, lineHeight: size.secondary * 1.6 }, meta: { ...font.regular, fontSize: size.small, color: colors.tx3, lineHeight: size.small * 1.6 },
  next: { ...font.regular, fontSize: size.secondary, color: colors.brand, lineHeight: size.secondary * 1.6 }, error: { color: colors.bad, fontSize: size.secondary },
  card: { gap: 7, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: overlay.hair, borderRadius: 9 },
  button: { minHeight: 38, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 7, borderWidth: 1, borderColor: overlay.hair, justifyContent: 'center' },
  buttonText: { ...font.medium, color: colors.tx2, fontSize: size.secondary, flexShrink: 1 }, selected: { borderColor: colors.brand, backgroundColor: overlay.fill }, disabled: { opacity: 0.45 },
  fold: { borderWidth: 1, borderColor: overlay.hair, borderRadius: 9, overflow: 'hidden' }, foldHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, minHeight: 44 }, foldBody: { padding: 11, gap: 10 },
  form: { padding: 12, gap: 13, backgroundColor: overlay.fill, borderRadius: 9 }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, color: colors.tx, fontSize: size.body, backgroundColor: colors.card, minHeight: 42 }, multiline: { minHeight: 64, textAlignVertical: 'top' },
})
