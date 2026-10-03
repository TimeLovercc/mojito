import { Redirect } from 'expo-router'
export { PageError as ErrorBoundary } from '../src/components/PageError'

// 桌面小组件"笔记"打开 mojito://note：转到笔记页签，输入框自动聚焦
export default function NoteRedirect() {
  return <Redirect href={{ pathname: '/notes', params: { focus: '1' } }} />
}
