import { useState, type Dispatch, type SetStateAction } from 'react'

// 输入框草稿：原生端不落盘，就是普通 state（网页版见 draft.web.ts）
export function useDraft(_key: string): [string, Dispatch<SetStateAction<string>>] {
  return useState('')
}
