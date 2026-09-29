import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { routeOf } from '../src/push-route'
import { trackView } from '../src/usage'

// 点网页推送打开的页面（docs/api.md "/app/open"）：按 routeOf 跳过去，记一次 push_open。
// 任何人都能构造这个链接，所以这里不改任何状态
export default function OpenScreen() {
  const params = useLocalSearchParams<{ record_id: string; kind: string; item_id?: string }>()
  const router = useRouter()
  useEffect(() => {
    trackView('push_open')
    router.replace(routeOf({ record_id: params.record_id, kind: params.kind, item_id: params.item_id === undefined ? null : params.item_id }))
  }, [])
  return null
}
