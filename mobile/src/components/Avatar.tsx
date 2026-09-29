import { Image } from 'react-native'

// mojito 的头像，与 app 图标、widget 同源（assets/widget-avatar.png）
export function Avatar({ size }: { size: number }) {
  return <Image source={require('../../assets/widget-avatar.png')} style={{ width: size, height: size, borderRadius: size / 2 }} />
}
