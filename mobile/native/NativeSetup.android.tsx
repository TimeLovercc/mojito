import { useEffect } from 'react'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { hubRequest } from '../src/api/client'
import { useConfig } from '../src/config/context'
import { t } from '../src/i18n'
import { useErrorToast, useToast } from '../src/toast'
import { ensureChannels, isReply, registerDevice, routeOf, sendReply, type Target } from './push'
import { refreshTodayWidget } from './widgets/today'

// 挂在根 _layout 里，不渲染任何东西：通知权限与渠道、向 hub 登记 FCM token、点通知跳转、前台内联回复、退到后台时刷新 widget。
export function NativeSetup() {
  const { config } = useConfig()
  const router = useRouter()
  const toast = useToast()
  const showError = useErrorToast()
  const response = Notifications.useLastNotificationResponse()

  useEffect(() => {
    ensureChannels().then(() => Notifications.requestPermissionsAsync())
  }, [])

  // 每次启动（和换 hub 后）都登记一次，POST /devices 是幂等的；token 轮换时再登记
  useEffect(() => {
    if (config.hub === null) return
    const hub = config.hub
    const fail = (err: Error) => showError(t('推送登记失败'), err)
    registerDevice(hub).catch(fail)
    const sub = Notifications.addPushTokenListener((t) => {
      hubRequest(hub, 'POST', '/devices', { fcm_token: t.data }).catch(fail)
    })
    return () => sub.remove()
  }, [config.hub])

  useEffect(() => {
    if (response === null || response === undefined) return
    Notifications.clearLastNotificationResponse()
    if (isReply(response)) {
      // app 不在前台时由后台任务发（background.android.tsx），这里只管前台，避免发两次
      if (AppState.currentState !== 'active') return
      sendReply(response).then(
        () => toast(t('已回复'), false),
        (err: Error) => showError(t('回复没发出去'), err),
      )
      return
    }
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    router.push(routeOf(response.notification.request.content.data as Target))
  }, [response])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background') return
      refreshTodayWidget().catch((err: Error) => console.warn(`widget 刷新失败：${err.message}`))
    })
    return () => sub.remove()
  }, [])

  return null
}
