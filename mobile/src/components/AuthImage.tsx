import { useEffect, useState } from 'react'
import { Image, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native'
import type { HubConfig } from '../config/store'
import { useConfig } from '../config/context'
import { humanize } from '../errors'
import { colors, size } from '../theme'
import { t } from '../i18n'

// GET /attachments/{id} 要带令牌。Android 上 Image 的 source.headers 会被丢掉（服务器收不到 Authorization），
// 所以自己带令牌取回字节，转成 data URI 再显示；同一张图在内存里只取一次
const cache = new Map<string, string>()

async function load(hub: HubConfig, id: string): Promise<string> {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  const res = await fetch(`${hub.hubUrl.replace(/\/+$/, '')}/attachments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${hub.token}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const uri = `data:image/jpeg;base64,${btoa(binary)}`
  cache.set(id, uri)
  return uri
}

export function AuthImage({ id, style, contain }: { id: string; style: StyleProp<ImageStyle & ViewStyle>; contain: boolean }) {
  const { config } = useConfig()
  const [src, setSrc] = useState<string | null>(() => {
    const hit = cache.get(id)
    return hit === undefined ? null : hit
  })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (config.hub === null) throw new Error(t('没有 hub 配置，不能取图片'))
    load(config.hub, id)
      .then(setSrc)
      .catch((err: Error) => setError(humanize(err).message))
  }, [id, config.hub])
  if (error !== null) return <Text style={{ color: colors.bad, fontSize: size.small }}>{t('图片取不到：{error}', { error })}</Text>
  // 还在取：占位，尺寸和图片一样，不引起重排
  if (src === null) return <View style={[style, { backgroundColor: colors.raised }]} />
  return <Image source={{ uri: src }} style={style} resizeMode={contain ? 'contain' : 'cover'} />
}
