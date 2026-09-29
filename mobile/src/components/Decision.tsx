import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Check, Ellipsis } from 'lucide-react-native'
import { actions } from '../api/client'
import { useRouter } from 'expo-router'
import type { Decision, Feedback, Item, Plan, PlansList, Project, ProjectAction } from '../api/types'
import { useHub } from '../use-hub'
import type { HubConfig } from '../config/store'
import { useConfig } from '../config/context'
import { useRefresh } from '../refresh'
import { useErrorToast, useToast } from '../toast'
import { trackAction } from '../usage'
import { colors, desktop, font, radii, shadow, size } from '../theme'
import { Btn } from './ui'
import { t, tc } from '../i18n'

// 拍板动作共用：发请求、提示结果、让页面重新取数据
export function useAct() {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  async function act(label: string, run: (hub: HubConfig) => Promise<unknown>) {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await run(config.hub)
      toast(label, false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('失败'), err)
    } finally {
      setBusy(false)
    }
  }
  return { act, busy }
}

// 等你拍板只有"同意""不要"；推迟在对话里说（design.md 8.3）
export function ItemDecision({ item }: { item: Item }) {
  const { act, busy } = useAct()
  const decide = (d: Decision, label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action: d.action, object: 'item' })
      return actions.decide(hub, item.id, d)
    })
  return (
    <View style={styles.btns}>
      <Btn label={t('同意')} primary disabled={busy} onPress={() => decide({ action: 'approve' }, t('已同意'))} />
      <Btn label={t('不要')} danger disabled={busy} onPress={() => decide({ action: 'decline' }, t('已关闭'))} />
    </View>
  )
}

// 维护会话改好了、等你确认才上线的反馈
export function FeedbackDecision({ fb }: { fb: Feedback }) {
  const { act, busy } = useAct()
  const decide = (action: 'approve' | 'decline', label: string) =>
    act(label, (hub) => {
      trackAction('feedback_decision', { action })
      return actions.decideFeedback(hub, fb.id, action)
    })
  return (
    <View style={styles.btns}>
      <Btn label={t('同意上线')} primary disabled={busy} onPress={() => decide('approve', t('已同意，维护会话会上线'))} />
      <Btn label={t('不要')} danger disabled={busy} onPress={() => decide('decline', t('已放弃这个改动'))} />
    </View>
  )
}

// 事项详情顶部：进行中的一个"完成"按钮，"⋯"里是关闭（先确认一次）；已完成/已关闭的"⋯"里是重新打开。事项不删除
export function ItemLifecycle({ item }: { item: Item }) {
  const { busy, decide } = useItemDecide(item)
  const [menu, setMenu] = useState(false)
  const ended = item.status === 'done' || item.status === 'closed'
  return (
    <View style={styles.btns}>
      {ended ? null : <Btn label={t('完成')} primary icon={Check} disabled={busy} onPress={() => decide({ action: 'done' }, t('已完成'))} />}
      <Pressable accessibilityLabel={t('更多操作')} hitSlop={6} onPress={() => setMenu(true)} style={styles.more}>
        <Ellipsis size={18} color={colors.tx2} />
      </Pressable>
      <LifecycleConfirm item={item} open={menu} onClose={() => setMenu(false)} />
    </View>
  )
}

// 事项的完成 / 关闭 / 重新打开：手机事项详情和电脑顶栏共用
export function useItemDecide(item: Item): { busy: boolean; decide: (d: Decision, label: string) => Promise<void> } {
  const { act, busy } = useAct()
  const decide = (d: Decision, label: string) =>
    act(label, (hub) => {
      trackAction('decision', { action: d.action, object: 'item' })
      return actions.decide(hub, item.id, d)
    })
  return { busy, decide }
}

// 关闭 / 重新打开前的确认弹层（关闭不删除，可以重新打开，动态里也能撤销）
export function LifecycleConfirm({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { busy, decide } = useItemDecide(item)
  const ended = item.status === 'done' || item.status === 'closed'
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.heading}>{ended ? t('重新打开这件事？') : t('关闭这件事？')}</Text>
          <Text style={styles.body}>
            {ended
              ? t('「{title}」会回到进行中。', { title: item.title })
              : t('「{title}」会标成已关闭，不会删除，之后可以重新打开；动态里也能撤销。', { title: item.title })}
          </Text>
          <View style={styles.btns}>
            <Btn label={t('取消')} onPress={onClose} />
            <Btn
              label={ended ? t('重新打开') : tc('按钮', '关闭')}
              danger={!ended}
              primary={ended}
              disabled={busy}
              onPress={() => {
                onClose()
                if (ended) decide({ action: 'reopen' }, t('已重新打开'))
                else decide({ action: 'close' }, t('已关闭'))
              }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// 没复盘不开新一期：之前还有没复盘完的计划时，按钮换成"先复盘"，跳到那一期
export function PlanApprove({ plan }: { plan: Plan }) {
  const { act, busy } = useAct()
  const router = useRouter()
  const plans = useHub<PlansList>('/plans')
  const blocking = plans.data === null ? undefined : blockingReview(plans.data.plans, plan)
  if (blocking !== undefined && desktop) {
    // 电脑上不画整宽的按钮，写一句琥珀色的"先复盘上期 ›"（docs/desktop-v2.md #10）
    return (
      <Text style={styles.blocked} onPress={() => router.push({ pathname: '/plans/[id]', params: { id: blocking.id } })}>
        {t('先复盘上期 ›')}
      </Text>
    )
  }
  if (blocking !== undefined) {
    return (
      <Btn
        label={blocking.review_status === 'draft' ? t('先完成上期复盘') : t('上期还没复盘')}
        primary
        onPress={() => router.push({ pathname: '/plans/[id]', params: { id: blocking.id } })}
      />
    )
  }
  return (
    <Btn
      label={plan.revises === null ? t('同意这期计划') : t('同意修订版')}
      primary
      disabled={busy || plans.data === null}
      onPress={() =>
        act(t('计划已生效'), (hub) => {
          trackAction('decision', { action: 'approve', object: 'plan' })
          return actions.approvePlan(hub, plan.id)
        })
      }
    />
  )
}

// 和 hub 批准计划时的检查一致（main.py plan_approve）：比这期开始早、已生效、复盘没做完的期挡住批准，
// 修订版也一样；已被非草稿修订版替代的那一期不用自己复盘（由修订版代表）
export function blockingReview(plans: Plan[], plan: Plan): Plan | undefined {
  const replaced = new Set(plans.filter((q) => q.revises !== null && q.status !== 'draft').map((q) => q.revises))
  return plans.find((p) => p.status !== 'draft' && p.end < plan.start && p.review_status !== 'done' && !replaced.has(p.id))
}

export const projectActions: Record<
  Project['status'],
  { action: ProjectAction; label: string; done: string; primary: boolean; danger: boolean }[]
> = {
  proposed: [
    { action: 'approve', label: t('确认为项目'), done: t('已加入项目'), primary: true, danger: false },
    { action: 'decline', label: t('不要'), done: t('已忽略'), primary: false, danger: true },
  ],
  active: [
    { action: 'pause', label: tc('按钮', '暂停'), done: t('已暂停'), primary: false, danger: false },
    { action: 'done', label: t('完成'), done: t('已完成'), primary: false, danger: false },
  ],
  paused: [
    { action: 'resume', label: t('恢复'), done: t('已恢复'), primary: true, danger: false },
    { action: 'done', label: t('完成'), done: t('已完成'), primary: false, danger: false },
  ],
  done: [{ action: 'resume', label: t('重新打开'), done: t('已重新打开'), primary: false, danger: false }],
  declined: [],
}

// 项目拍板：proposed 确认/不要；进行中可暂停、完成
export function ProjectDecision({ project }: { project: Project }) {
  const { act, busy } = useAct()
  const list = projectActions[project.status]
  if (list.length === 0) return null
  return (
    <View style={styles.btns}>
      {list.map((a) => (
        <Btn
          key={a.action}
          label={a.label}
          primary={a.primary}
          danger={a.danger}
          disabled={busy}
          onPress={() =>
            act(a.done, (hub) => {
              trackAction('decision', { action: a.action, object: 'project' })
              return actions.decideProject(hub, project.id, a.action)
            })
          }
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  btns: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  // 电脑上确认弹层最宽 420 居中（docs/desktop-v2.md #10）
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 12,
    ...(desktop ? { width: '100%' as const, maxWidth: 420, alignSelf: 'center' as const, boxShadow: shadow.popover } : {}),
  },
  blocked: { ...font.medium, fontSize: size.secondary, color: colors.warn },
  body: { ...font.regular, fontSize: size.body, color: colors.tx2 },
  heading: { ...font.bold, fontSize: size.title, color: colors.tx },
  more: {
    width: 38,
    height: 34,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
