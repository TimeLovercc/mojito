import { useEffect, useState } from 'react'
import { Image, Text, type ImageStyle, type StyleProp } from 'react-native'
import { useConfig } from '../config/context'
import { humanize } from '../errors'
import { colors, size } from '../theme'
import { t } from '../i18n'

// 网页开发模式：<img> 不能带请求头，先带令牌 fetch 成 blob URL
export function AuthImage({ id, style, contain }: { id: string; style: StyleProp<ImageStyle>; contain: boolean }) {
  const { config } = useConfig()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (config.hub === null) throw new Error(t('没有 hub 配置，不能取图片'))
    let url: string | null = null
    fetch(`${config.hub.hubUrl.replace(/\/+$/, '')}/attachments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${config.hub.token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
        url = URL.createObjectURL(await res.blob())
        setSrc(url)
      })
      .catch((err: Error) => setError(humanize(err).message))
    return () => {
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [id, config.hub])
  if (error !== null) return <Text style={{ color: colors.bad, fontSize: size.small }}>{t('图片取不到：{error}', { error })}</Text>
  if (src === null) return null
  return <Image source={{ uri: src }} style={style} resizeMode={contain ? 'contain' : 'cover'} />
}
