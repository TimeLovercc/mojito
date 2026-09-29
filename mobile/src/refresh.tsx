import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { actions } from './api/client'
import type { Job } from './api/types'
import { useConfig } from './config/context'
import { useErrorToast, useToast } from './toast'
import { trackAction } from './usage'
import { t } from './i18n'

// 刷新任务：POST /jobs 后轮询 GET /jobs/{id}。Mac 睡着时一直是 queued，显示"已排队"。
// version 在刷新完成或任何动作之后递增，页面据此重新取数据。
type RefreshState = { job: Job | null; start: () => Promise<void>; version: number; bump: () => void }

const RefreshContext = createContext<RefreshState | null>(null)
const JOB_KEY = 'mojito.refreshJob'
const POLL_MS = 3000

export function RefreshProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [job, setJob] = useState<Job | null>(null)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // 回到前台时让已挂载的页面重新取数据：切出去期间 agent 可能改了事项、关了计划
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump()
    })
    return () => sub.remove()
  }, [bump])

  useEffect(() => {
    AsyncStorage.getItem(JOB_KEY).then((raw) => {
      if (raw !== null) setJob(JSON.parse(raw) as Job)
    })
  }, [])

  const pending = job !== null && (job.status === 'queued' || job.status === 'running')
  const hub = config.hub

  useEffect(() => {
    if (!pending || hub === null) return
    const id = job.id
    const timer = setInterval(async () => {
      try {
        const next = await actions.getJob(hub, id)
        await AsyncStorage.setItem(JOB_KEY, JSON.stringify(next))
        setJob(next)
        if (next.status === 'done') {
          toast(t('更新好了'), false)
          bump()
        }
        if (next.status === 'failed') toast(t('刷新失败：{error}', { error: String(next.error) }), true)
      } catch (err) {
        if (!(err instanceof Error)) throw err
        showError(t('查刷新状态失败'), err)
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [pending, hub, job?.id, toast, bump])

  const start = useCallback(async () => {
    if (hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    try {
      const created = await actions.requestRefresh(hub)
      trackAction('refresh', null)
      await AsyncStorage.setItem(JOB_KEY, JSON.stringify(created))
      setJob(created)
      toast(created.status === 'queued' ? t('已排队，Mac 醒着就会开始') : t('已开始刷新'), false)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('刷新请求失败'), err)
    }
  }, [hub, toast])

  return <RefreshContext.Provider value={{ job, start, version, bump }}>{children}</RefreshContext.Provider>
}

export function useRefresh(): RefreshState {
  const ctx = useContext(RefreshContext)
  if (ctx === null) throw new Error('useRefresh 必须在 RefreshProvider 内使用')
  return ctx
}
