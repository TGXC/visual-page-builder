/**
 * 自定义组件（AI 生成的受限 DSL）的本地持久化（M7）。
 *
 * 只存 **DSL 数据**，不存函数：读回来重新 `compileDsl()` 一遍才进注册表 ——
 * 这样存档里塞不进可执行内容，跨会话也不会因为描述符形状变化而炸。
 * 与文档存档一样，任何失败都静默降级（返回空表 / false），不打断编辑。
 */
import type { ComponentDsl } from '../dsl'
import { validateDsl } from '../dsl'

export const CUSTOM_DSL_KEY = 'studio.custom.components.v1'

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** 读存档：坏 JSON / 非数组 / 校验不过的条目一律丢弃 */
export function loadCustomDsl(): ComponentDsl[] {
  const target = storage()
  if (!target) return []
  try {
    const raw = target.getItem(CUSTOM_DSL_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ComponentDsl => validateDsl(item).length === 0)
  } catch {
    return []
  }
}

export function saveCustomDsl(list: readonly ComponentDsl[]): boolean {
  const target = storage()
  if (!target) return false
  try {
    target.setItem(CUSTOM_DSL_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}
