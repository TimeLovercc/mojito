// 网页版（PWA）的运行环境（网页端见 pwa.web.ts）。原生端永远是 null，所有 PWA 行为都用 pwa !== null 判断
export type Pwa = { build: string; ios: boolean; standalone: boolean }
export const pwa: Pwa | null = null
