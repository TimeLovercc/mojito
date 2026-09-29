import { tauri } from './tauri'
import { colors, desktop, overlay } from './theme'

// 电脑样式（docs/desktop-v2.md 动效、光标、焦点）：只在电脑密度（desktop）下注入，手机网页调试不受影响
export function installDesktopCss() {
  if (!desktop) return
  const root = document.documentElement
  root.lang = 'zh-CN'
  const css = `
    html { -webkit-font-smoothing: antialiased; }
    /* 界面文字不可选（WebKit 只认带前缀的写法）；输入框和标了 userSelect:text 的正文可选 */
    body { -webkit-user-select: none; user-select: none; cursor: default; }
    input, textarea { -webkit-user-select: text; user-select: text; cursor: text; }
    /* 默认箭头光标；焦点环只在键盘操作时出现 */
    div[tabindex="0"] { cursor: default; outline: none; }
    div[tabindex="0"]:focus-visible { box-shadow: 0 0 0 3px ${colors.brand}59; border-radius: 6px; }
    textarea:focus, input:focus { outline: none; }
    /* 行和导航的悬停 / 按下底色（组件用 hoverRow 标记） */
    [data-hover="row"] { transition: background-color 120ms cubic-bezier(.32,.72,0,1); }
    [data-hover="row"]:hover { background-color: ${overlay.hover}; }
    [data-hover="row"]:active { background-color: ${overlay.pressed}; }
    /* 对话输入卡上方的渐变遮罩 */
    [data-fade="top"] { background: linear-gradient(to bottom, ${colors.bg}00, ${colors.bg}); pointer-events: none; }
    /* 滚动不回弹；图片不能拖出窗口 */
    * { overscroll-behavior: none; }
    img, svg { -webkit-user-drag: none; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `
  const style = document.createElement('style')
  style.textContent = css
  // Mac app 窗口背后是 macOS 侧边栏毛玻璃：根背景透明透出来，内容区自己不透明（app/_layout.tsx 的 Shell）
  if (tauri !== null) style.textContent += 'html, body, #root { background: transparent !important; }'
  document.head.appendChild(style)
  // 去掉 WebView 痕迹：非文字区不弹右键菜单（选中了文字、或在输入框里时照常）
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    const selection = window.getSelection()
    if (target.closest('input, textarea') !== null) return
    if (selection !== null && selection.toString() !== '') return
    e.preventDefault()
  })
}
