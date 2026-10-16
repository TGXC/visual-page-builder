import type { FormSchema } from '@/core/types'

/** 持久化协议：键名带版本号，读档时也按版本号拒绝旧数据。 */
export const STORAGE_KEY = 'form-builder:v1:schema'

/** 自动保存的防抖时间：拖拽一次只写一次盘，连续输入也不会每字符写。 */
export const PERSIST_DELAY = 300

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式 / 禁用 cookie 时读 localStorage 本身就会抛
    return null
  }
}

/**
 * 读档：只做「坏数据不进 store」这一件事，真正的字段收敛留给 M6 的 normalizeSchema。
 * 返回 null 一律表示「当作没有存档」。
 */
export function loadSchema(): FormSchema | null {
  const store = storage()
  if (!store) return null

  const raw = store.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<FormSchema> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== 1) return null
    if (!Array.isArray(parsed.fields)) return null
    return parsed as FormSchema
  } catch {
    return null
  }
}

/** 写档：配额满或隐私模式下静默失败，绝不因此打断编辑。 */
export function saveSchema(schema: FormSchema): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(schema))
  } catch {
    /* 忽略：存不下不是致命错误 */
  }
}

export function clearSchema(): void {
  storage()?.removeItem(STORAGE_KEY)
}
