import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget'
import { T, W } from './style'
import { t } from '../../src/i18n'

// lucide 的 pen 图标
const PEN = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${W.btnTx}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`

// 笔记（原"记一笔"）：整块点开直达 app 的笔记页（mojito://note）
export function NoteWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'mojito://note' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: W.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: W.border,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexGap: 10,
      }}
    >
      <FlexWidget
        style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: W.btn, alignItems: 'center', justifyContent: 'center' }}
      >
        <SvgWidget svg={PEN} style={{ width: 22, height: 22 }} />
      </FlexWidget>
      <TextWidget text={t('笔记')} style={{ fontSize: T.minor, color: W.sub }} />
    </FlexWidget>
  )
}
