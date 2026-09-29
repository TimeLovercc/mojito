import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { actions } from '../api/client'
import type { HubRecord, JobsList } from '../api/types'
import { useConfig } from '../config/context'
import { useRefresh } from '../refresh'
import { useErrorToast, useToast } from '../toast'
import { trackAction } from '../usage'
import { colors, font, size } from '../theme'
import { useHub } from '../use-hub'
import { t } from '../i18n'

// agent 做过的可撤销动作（如写日历）：未撤销显示"撤销"，撤销任务在跑显示"撤销中"，hub 标了 undone_at 显示"已撤销"
export function UndoButton({ record, label }: { record: HubRecord; label: string }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const jobs = useHub<JobsList>('/jobs')
  const [busy, setBusy] = useState(false)
  const job = jobs.data === null ? undefined : jobs.data.jobs.find((j) => j.kind === 'undo' && j.record_id === record.id)
  // 任务跑完到记录刷新出 undone_at 之间也算撤销中
  const pending = job !== undefined && job.status !== 'failed' && record.undone_at === null
  // 撤销在跑时每 3 秒重取任务和页面，直到 hub 标上 undone_at
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      jobs.refresh()
      bump()
    }, 3000)
    return () => clearInterval(timer)
  }, [pending, jobs.refresh, bump])
  if (record.undo === null) return null
  if (record.undone_at !== null) return <Text style={[styles.text, { color: colors.tx2 }]}>{t('已撤销')}</Text>
  if (pending) return <Text style={[styles.text, { color: colors.warn }]}>{t('撤销中…')}</Text>
  const undo = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      const job = await actions.undo(config.hub, record.id)
      trackAction('undo', null)
      // hub 自己能撤的（事项、笔记整理等）直接返回 done；日历要排队给 服务器 agent
      toast(job.status === 'done' ? t('已撤销') : t('撤销已排队，服务器 agent 会做反向操作'), false)
      jobs.refresh()
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('撤销失败'), err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Pressable onPress={undo} disabled={busy} hitSlop={8}>
      <Text style={[styles.text, { color: colors.brand }, busy && { opacity: 0.5 }]}>
        {job !== undefined && job.status === 'failed' ? t('撤销失败（{error}），再试一次', { error: String(job.error) }) : label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  text: { ...font.regular, fontSize: size.small },
})
