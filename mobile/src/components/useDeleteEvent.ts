import { useEffect, useState } from 'react'
import { actions } from '../api/client'
import type { CalEvent, Job } from '../api/types'
import { useConfig } from '../config/context'
import { useRefresh } from '../refresh'
import { t } from '../i18n'
import { useErrorToast, useToast } from '../toast'

// 删日程（design.md 8.5）：任何日程都能删，服务器 agent 真的从 Google 日历删掉（带 start，重复日程只删这一次），
// 时间线留一条可撤销的记录。删除任务跑完后重取页面，这一行就消失了。手机今天页和电脑今天页共用
export function useDeleteEvent(e: CalEvent): { deleting: boolean; remove: () => Promise<void> } {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [job, setJob] = useState<Job | null>(null)

  useEffect(() => {
    if (job === null || job.status === 'done' || job.status === 'failed') return
    const hub = config.hub
    if (hub === null) throw new Error('没有 hub 配置')
    const timer = setTimeout(() => {
      actions
        .getJob(hub, job.id)
        .then((next) => {
          setJob(next)
          if (next.status === 'done') bump()
          if (next.status === 'failed') toast(t('没删掉：{error}', { error: String(next.error) }), true)
        })
        .catch((err: Error) => showError(t('查不到删除进度'), err))
    }, 3000)
    return () => clearTimeout(timer)
  }, [job])

  const remove = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    try {
      setJob(await actions.deleteEvent(config.hub, e.uid, e.start))
      toast(t('正在从 Google 日历删除，删完时间线里可以撤销'), false)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没删掉'), err)
    }
  }
  return { deleting: job !== null && job.status !== 'failed', remove }
}
