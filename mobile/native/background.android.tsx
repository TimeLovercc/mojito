import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import { isReply, parsePush, present, sendReply } from './push'
import { NoteWidget } from './widgets/NoteWidget'
import { cachedToday, fetchToday, NOTE_WIDGET, refreshTodayWidget, renderToday } from './widgets/today'

// 由 mobile/index.ts 在 expo-router 之前加载：后台任务必须在模块顶层定义（expo-notifications / widget 的要求）。

const PUSH_TASK = 'mojito-push'

// 前台只显示我们自己按 tier 排的本地通知。远程 data 消息（trigger.type = 'push'）不显示：
// expo-notifications 会把 data 里的 title 键当成通知标题，放行的话同一条推送会弹两条（下面的任务还会 present 一条）。
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const trigger = n.request.trigger
    const show = !(trigger !== null && 'type' in trigger && trigger.type === 'push')
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false }
  },
})

// 收到 FCM data 消息（前台、后台、进程被杀都会跑）；app 不在前台时通知上的"回复"也走这里。
TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error !== null) throw new Error(`推送任务出错：${error.message}`)
  if ('actionIdentifier' in data) {
    if (isReply(data)) await sendReply(data)
    return
  }
  await present(parsePush(data.data))
  await refreshTodayWidget()
})
Notifications.registerTaskAsync(PUSH_TASK)

registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return
  if (widgetInfo.widgetName === NOTE_WIDGET) {
    renderWidget(<NoteWidget />)
    return
  }
  const name = widgetInfo.widgetName
  renderWidget(renderToday(name, await cachedToday()))
  // 定时刷新（updatePeriodMillis）和刚放到桌面时向 hub 取新数据
  if (widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED') renderWidget(renderToday(name, await fetchToday()))
})
