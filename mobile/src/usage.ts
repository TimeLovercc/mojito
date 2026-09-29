import { useCallback, useEffect } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { actions, HubError } from './api/client'
import * as Updates from 'expo-updates'
import type { FeedbackContext, UsageEvent } from './api/types'
import { loadConfig } from './config/store'
import { pwa } from './pwa'

// 使用记录（docs/api.md"使用记录"）：本地攒着，回到前台或攒满 20 条时 POST /usage。
// 只记枚举类信息，不记正文。失败留着下次再发；hub 回 422 说明这批格式不对，丢掉不重发。
export type ViewName =
  | 'today'
  | 'plan_current'
  | 'plan_history'
  | 'plan_detail'
  | 'projects'
  | 'project_detail'
  | 'items'
  | 'item_detail'
  | 'feed' // 信息流页
  | 'card_detail'
  | 'timeline' // 全部动态（系统页进入）
  | 'notes' // 笔记页
  | 'feedback_sheet'
  | 'app_open'
  | 'chat'
  | 'system'
  | 'note_sheet'
  | 'widget_today'
  | 'widget_note'
  | 'push_open'

export type ActionName =
  | 'note'
  | 'decision'
  | 'refresh'
  | 'chat_send'
  | 'item_ask'
  | 'undo'
  | 'draft_copy'
  | 'draft_resolve'
  | 'review_finish'
  | 'review_start'
  | 'settings_save'
  | 'open_orca'
  | 'inline_reply'
  | 'card_save'
  | 'card_dismiss'
  | 'card_ask'
  | 'card_to_item'
  | 'client_error'
  | 'feedback_send'
  | 'feedback_decision'
  | 'push_enable' // 网页版开启推送（design.md 8.8）
  | 'push_disable'

const KEY = 'mojito.usage.pending'
const BATCH = 20

let pending: UsageEvent[] = []
let loaded = false
let flushing = false

async function load() {
  if (loaded) return
  const raw = await AsyncStorage.getItem(KEY)
  // 读的时候可能已经记了几条，放在后面
  pending = [...(raw === null ? [] : (JSON.parse(raw) as UsageEvent[])), ...pending]
  loaded = true
}

async function save() {
  await AsyncStorage.setItem(KEY, JSON.stringify(pending))
}

export async function flushUsage(): Promise<void> {
  await load()
  if (flushing || pending.length === 0) return
  const config = await loadConfig()
  if (config.hub === null) return
  flushing = true
  const batch = pending.slice(0, BATCH)
  try {
    await actions.postUsage(config.hub, batch)
    pending = pending.slice(batch.length)
  } catch (err) {
    if (!(err instanceof Error)) throw err
    if (err instanceof HubError && err.status === 422) {
      console.warn(`POST /usage 422，丢弃这批 ${batch.length} 条：${err.message}`)
      pending = pending.slice(batch.length)
    } else {
      // 连不上或 hub 出错：留着，下次回到前台再发
      console.warn(`POST /usage 失败，下次再发：${err.message}`)
    }
  } finally {
    flushing = false
    await save()
  }
}

function record(event: UsageEvent) {
  pending.push(event)
  load()
    .then(save)
    .then(() => (pending.length >= BATCH ? flushUsage() : undefined))
}

export function trackView(name: ViewName) {
  record({ at: new Date().toISOString(), kind: 'view', name, detail: null })
}

export function trackAction(name: ActionName, detail: Record<string, string | boolean> | null) {
  record({ at: new Date().toISOString(), kind: 'action', name, detail })
}

// 反馈时带上"用户是从哪个页面来的"：对话页、反馈页、笔记页（弹出的那个）本身不算
const PASS_THROUGH: ViewName[] = ['chat', 'feedback_sheet', 'note_sheet']
let screen: { name: ViewName | null; item_id: string | null; project_id: string | null } = { name: null, item_id: null, project_id: null }

export function feedbackContext(): FeedbackContext {
  // 网页版没有空中更新，填 web:<build>
  const appUpdateId = pwa === null ? Updates.updateId : `web:${pwa.build}`
  return { screen: screen.name, item_id: screen.item_id, project_id: screen.project_id, app_update_id: appUpdateId }
}

// 页面每次获得焦点记一次 view，并记为当前页面
export function useViewTracking(name: ViewName) {
  useFocusEffect(
    useCallback(() => {
      trackView(name)
      if (!PASS_THROUGH.includes(name)) screen = { name, item_id: null, project_id: null }
    }, [name]),
  )
}

// 事项 / 项目详情在 useViewTracking 之后调用，补上当前页面对应的 id
export function useScreenIds(itemId: string | null, projectId: string | null) {
  useFocusEffect(
    useCallback(() => {
      screen = { ...screen, item_id: itemId, project_id: projectId }
    }, [itemId, projectId]),
  )
}

// 挂在根布局：启动和每次回到前台时记 app_open 并上报。
// Mac 菜单栏面板（/menubar）传 false：面板每次弹出都算一次"打开"会把检验指标撑大（docs/desktop-v2.md #16）
export function useUsageFlush(countOpens: boolean) {
  useEffect(() => {
    if (!countOpens) return
    // 检验指标"每天打开次数"：冷启动和每次回到前台各记一次 app_open
    trackView('app_open')
    flushUsage()
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      trackView('app_open')
      flushUsage()
    })
    return () => sub.remove()
  }, [countOpens])
}
