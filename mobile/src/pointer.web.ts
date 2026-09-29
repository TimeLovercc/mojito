import { tauri } from './tauri'

// Mac app 一律当有鼠标；浏览器看主输入设备能不能悬停、是不是精确指针。
// iPhone、iPad（没接触控板）为 false：字号和按键行为按触屏处理，回车是换行（design.md 8.8）
export const finePointer = tauri !== null || window.matchMedia('(hover: hover) and (pointer: fine)').matches
