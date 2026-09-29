import { useEffect, useState } from 'react'
import { Image, Pressable, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native'
import type { HubConfig } from '../config/store'
import { useConfig } from '../config/context'
import { humanize } from '../errors'
import { colors, size } from '../theme'
import { t } from '../i18n'

// 网页和 Mac app：<img> 不能带请求头，先带令牌 fetch 成 blob URL。
// Mac app 里 fetch 走 Tauri HTTP 插件，偶尔整个请求挂住不返回（webview.log 里同时段的 /sources 也是超时才取消），
// 所以和 hubRequest 一样 20 秒没响应就中止并写明原因，不能一直空白。
// 同一张图只取一次（缩略图和点开的大图共用）；blob URL 留到页面关掉，不在组件卸载时回收——另一处可能还在显示它。
// 失败的不缓存，点一下重试
const TIMEOUT_MS = 20000
const cache = new Map<string, Promise<string>>()

function load(hub: HubConfig, id: string): Promise<string> {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 到时间就判失败，不等插件响应中止（挂住的请求中止后也可能迟迟不返回）
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new Error(t('hub {n} 秒没响应', { n: TIMEOUT_MS / 1000 })))
    }, TIMEOUT_MS)
  })
  const request = fetch(`${hub.hubUrl.replace(/\/+$/, '')}/attachments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${hub.token}` },
    signal: abort.signal,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    return URL.createObjectURL(await res.blob())
  })
  const job = Promise.race([request, timeout])
    .catch((err: Error) => {
      cache.delete(id)
      throw err
    })
    .finally(() => clearTimeout(timer))
  cache.set(id, job)
  return job
}

export function AuthImage({ id, style, contain }: { id: string; style: StyleProp<ImageStyle & ViewStyle>; contain: boolean }) {
  const { config } = useConfig()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (config.hub === null) throw new Error(t('没有 hub 配置，不能取图片'))
    let live = true
    setError(null)
    load(config.hub, id).then(
      (url) => live && setSrc(url),
      (err: Error) => live && setError(humanize(err).message),
    )
    return () => {
      live = false
    }
  }, [id, config.hub, attempt])
  if (error !== null) {
    return (
      <Pressable
        onPress={() => {
          cache.delete(id)
          setAttempt(attempt + 1)
        }}
      >
        <Text style={{ color: colors.bad, fontSize: size.small }}>
          {t('图片取不到：{error}', { error })} {t('点一下重试')}
        </Text>
      </Pressable>
    )
  }
  // 还在取：和图片同尺寸的占位，不引起重排
  if (src === null) return <View style={[style, { backgroundColor: colors.raised }]} />
  return (
    <Image
      source={{ uri: src }}
      style={style}
      resizeMode={contain ? 'contain' : 'cover'}
      onError={() => setError(t('图片解不开'))}
    />
  )
}
