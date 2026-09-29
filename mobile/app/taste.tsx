import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { actions } from '../src/api/client'
import type { TasteNote, TasteNotes } from '../src/api/types'
import { Screen } from '../src/components/Screen'
import { Btn, Card, Empty, Rows } from '../src/components/ui'
import { useConfig } from '../src/config/context'
import { sourceName } from '../src/labels'
import { useRefresh } from '../src/refresh'
import { when } from '../src/time'
import { useErrorToast, useToast } from '../src/toast'
import { colors, font, size } from '../src/theme'
import { useHub } from '../src/use-hub'
import { t } from '../src/i18n'

// 口味笔记：你在对话里说过的论文偏好（"多推开源工具""少推综述"），每天挑论文时参考。
// 不想再参考的点"不再生效"（POST /taste/{id}/retire）。新增在对话里说就行。
export default function TasteScreen() {
  const view = useHub<TasteNotes>('/taste')
  return (
    <Screen
      view={view}
      head={{ kind: 'back', label: t('信息流') }}
      top={
        <View style={{ gap: 4 }}>
          <Text style={styles.title}>{t('口味')}</Text>
          <Text style={styles.hint}>
            {t('挑论文时参考这些偏好，还会参考 Zotero 收藏、你收藏/不感兴趣的卡片和进行中的项目。想加一条，在对话里直接说。')}
          </Text>
        </View>
      }
    >
      {({ notes }) =>
        notes.length === 0 ? (
          <Empty text={t('还没有口味笔记')} />
        ) : (
          <Card>
            <Rows>
              {notes.map((n) => (
                <TasteRow key={n.id} note={n} />
              ))}
            </Rows>
          </Card>
        )
      }
    </Screen>
  )
}

function TasteRow({ note }: { note: TasteNote }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  const retire = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.retireTaste(config.hub, note.id)
      toast(t('这条不再参考了'), false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没改成'), err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.text}>{note.text}</Text>
        <Text style={styles.meta}>
          {when(note.at)} · {sourceName(note.source)}
        </Text>
      </View>
      <Btn label={t('不再生效')} disabled={busy} onPress={retire} />
    </View>
  )
}

const styles = StyleSheet.create({
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  hint: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13 },
  text: { ...font.regular, fontSize: size.body, color: colors.tx },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
