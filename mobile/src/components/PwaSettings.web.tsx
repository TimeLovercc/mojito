import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useConfig } from '../config/context'
import { colors, font, radii, size } from '../theme'
import { useErrorToast, useToast } from '../toast'
import { currentSubscription, disablePush, pushSupported } from '../webpush'
import { Btn, Card, Section } from './ui'
import { t } from '../i18n'

// 网页版（PWA）的连接设置：hub 就是页面同源，不显示地址；没有"去 Orca"。只能换令牌或清除令牌。
// 清除令牌前先关掉这台设备的推送（docs/api.md "关闭推送或清除令牌"）
export function PwaSettings() {
  const { config, update } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [token, setToken] = useState(config.hub === null ? '' : config.hub.token)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const tok = token.trim()
    setBusy(true)
    try {
      if (tok === '' && config.hub !== null && pushSupported()) {
        const sub = await currentSubscription()
        if (sub !== null) await disablePush(config.hub, sub)
      }
      await update({ hub: tok === '' ? null : { hubUrl: window.location.origin, token: tok }, orcaUrl: null })
      toast(tok === '' ? t('令牌已清除') : t('已保存'), false)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没保存上'), err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t('连接设置')}>
      <Card style={styles.form}>
        <Text style={styles.label}>{t('app 令牌')}</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder={t('Bearer 令牌')}
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.hint}>{t('令牌存在这个主屏 app 自己的存储里，删掉图标就清除。清空后保存会先关掉这台设备的推送。')}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Btn label={t('保存')} primary disabled={busy} onPress={save} />
        </View>
      </Card>
    </Section>
  )
}

const styles = StyleSheet.create({
  form: { padding: 13, gap: 7 },
  label: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  input: {
    ...font.regular,
    fontSize: size.body,
    color: colors.tx,
    backgroundColor: colors.raised,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  hint: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
