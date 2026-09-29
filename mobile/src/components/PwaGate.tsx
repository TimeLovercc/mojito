import type { ReactNode } from 'react'

// 网页版（PWA）的安装引导；原生端直接显示 app（网页端见 PwaGate.web.tsx）
export function PwaGate({ children }: { children: ReactNode }) {
  return children
}
