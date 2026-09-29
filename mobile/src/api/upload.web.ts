import type { HubConfig } from '../config/store'
import { t } from '../i18n'
import type { Attachment } from './types'
import { HubError, ReadableError } from './client'

// 网页开发模式：先把 blob: / data: uri 取成 Blob 再放进 FormData
export async function uploadImage(config: HubConfig, uri: string): Promise<Attachment> {
  const blob = await (await fetch(uri)).blob()
  const form = new FormData()
  form.append('file', new Blob([blob], { type: 'image/jpeg' }), 'image.jpg')
  return send(config, form)
}

// POST /attachments（multipart，字段 file）
async function send(config: HubConfig, form: FormData): Promise<Attachment> {
  const path = '/attachments'
  const res = await fetch(config.hubUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
  }).catch((err: Error) => {
    throw new ReadableError(t('连不上 hub（{error}）', { error: err.message }))
  })
  const text = await res.text()
  if (!res.ok) throw new HubError(res.status, path, text)
  return JSON.parse(text) as Attachment
}
