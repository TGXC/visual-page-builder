/**
 * 本地持久化：只用 localStorage，且读回来的一律先过收敛层。
 * 存档失败（隐私模式 / 配额满）都不能打断编辑，所以全部静默降级。
 */
import type { Doc } from '../schema/types'
import { normalizeDoc } from '../schema/normalize'

export const STORAGE_KEY = 'studio:doc:v2'
export const AUTOSAVE_DELAY = 400

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null
}

export function serializeDoc(doc: Doc): string {
  return JSON.stringify(doc)
}

export function saveDoc(doc: Doc): boolean {
  const target = storage()
  if (!target) return false
  try {
    target.setItem(STORAGE_KEY, serializeDoc(doc))
    return true
  } catch {
    return false
  }
}

export function loadDoc(): Doc | null {
  const target = storage()
  if (!target) return null
  try {
    const raw = target.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    // 结构不对的存档直接当作没有：宁可从空项目开始，也不要让收敛层「救」出一份空壳覆盖用户预期
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const candidate = parsed as { version?: unknown; pages?: unknown }
    if (candidate.version !== 2 || !Array.isArray(candidate.pages) || candidate.pages.length === 0) return null
    return normalizeDoc(parsed)
  } catch {
    return null
  }
}

export function clearDoc(): void {
  const target = storage()
  if (!target) return
  try {
    target.removeItem(STORAGE_KEY)
  } catch {
    /* 静默：清不掉也不影响使用 */
  }
}
