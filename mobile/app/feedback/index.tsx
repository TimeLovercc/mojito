import { StyleSheet, Text, View } from 'react-native'
import type { FeedbackList } from '../../src/api/types'
import { Composer } from '../../src/components/Chat'
import { FeedbackCard } from '../../src/components/FeedbackCard'
import { Screen } from '../../src/components/Screen'
import { Empty, Section } from '../../src/components/ui'
import { colors, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { t } from '../../src/i18n'

// 反馈问题（系统页进入）：写下哪里不对、可附截图；自动带上刚才所在的页面、事项/项目和当前 JS 包版本。
// 维护会话会分诊、修复；需要你确认才上线的进"等你拍板"。
export default function FeedbackScreen() {
  const view = useHub<FeedbackList>('/feedback')
  useViewTracking('feedback_sheet')
  return (
    <Screen
      view={view}
      head={{ kind: 'back', label: t('返回') }}
      top={
        <View style={{ gap: 4 }}>
          <Text style={styles.title}>{t('反馈与建议')}</Text>
          <Text style={styles.hint}>
            {t('说说哪里不对、想怎么改，可以附截图。会自动带上你刚才所在的页面和 app 版本。点开一条可以看和维护会话的讨论。')}
          </Text>
        </View>
      }
      bottom={<Composer target={{ kind: 'feedback' }} placeholder={t('说说哪里不对、想怎么改…')} chips={null} />}
    >
      {({ feedback }) => (
        <Section title={t('我提过的')} right={String(feedback.length)}>
          {feedback.length === 0 ? <Empty text={t('还没有反馈')} /> : null}
          {feedback.map((fb) => (
            <FeedbackCard key={fb.id} fb={fb} link />
          ))}
        </Section>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  hint: { ...font.regular, fontSize: size.secondary, color: colors.tx2 },
})
