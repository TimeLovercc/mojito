import { useCallback, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import type { HubConfig } from './config/store'
import { useConfig } from './config/context'
import { useErrorToast, useToast } from './toast'
import { t } from './i18n'

// "上次读到这里"：离开页面时才把看到的最新一条记为已读。
// 看的过程中后台同步会拿回新的已读位置，如果进页面就标记，分界线会在眼前跳到最上面。
export function useMarkReadOnLeave(
  newest: string | null,
  lastRead: string | null,
  live: boolean,
  post: (hub: HubConfig, id: string) => Promise<unknown>,
) {
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const latest = useRef({ newest, lastRead, live })
  latest.current = { newest, lastRead, live }
  const hub = config.hub
  useFocusEffect(
    useCallback(
      () => () => {
        const { newest: id, lastRead: read, live: fresh } = latest.current
        if (!fresh || id === null || id === read || hub === null) return
        post(hub, id).catch((err: Error) => showError(t('标记已读失败'), err))
      },
      [hub, post, toast],
    ),
  )
}
