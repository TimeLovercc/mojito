// 点通知后去哪（安卓 FCM 和网页版 Web Push 共用；推送里的 data 都由 hub 的 push_data 生成）

// 通知里带的数据，点开时据此跳转；card_id：新动态报告（design.md 8.10）挂的卡片
export type Target = { record_id: string; kind: string; item_id: string | null; card_id: string | null }

// 点通知：有事项去事项，有卡片去卡片详情，对话消息去对话页，其余去动态
export function routeOf(target: Target): string {
  if (target.item_id !== null) return `/items/${encodeURIComponent(target.item_id)}`
  if (target.card_id !== null) return `/cards/${encodeURIComponent(target.card_id)}`
  if (target.kind === 'chat') return '/chat'
  return '/feed'
}
