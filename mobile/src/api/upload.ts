import type { HubConfig } from '../config/store'
import { t } from '../i18n'
import { HubError, ReadableError } from './client'
import type { Attachment } from './types'

// 原生端：SDK 57 的全局 fetch（expo/fetch）不支持 FormData 里的 { uri, name, type } 文件，
// 所以用 React Native 自带的 XMLHttpRequest 上传本地文件
export function uploadImage(config: HubConfig, uri: string): Promise<Attachment> {
  const path = '/attachments'
  const form = new FormData()
  form.append('file', { uri, name: 'image.jpg', type: 'image/jpeg' } as unknown as Blob)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', config.hubUrl.replace(/\/+$/, '') + path)
    xhr.setRequestHeader('Authorization', `Bearer ${config.token}`)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Attachment)
      else reject(new HubError(xhr.status, path, xhr.responseText))
    }
    xhr.onerror = () => reject(new ReadableError(t('连不上 hub（上传图片失败）')))
    xhr.send(form)
  })
}
