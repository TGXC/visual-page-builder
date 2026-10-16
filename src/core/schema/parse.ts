import { isLegacyProject, migrateFromWebBuilderV1 } from './migrate'
import { normalizeDoc } from './normalize'
import type { Doc } from './types'

export type ImportResult =
  | { ok: true; doc: Doc; migratedFromV1: boolean }
  | { ok: false; error: string }

/**
 * 导入入口：喂进来一段文本（文件内容或 localStorage 里的值），
 * 自动识别「WebBuilder v1 项目」与「v2 文档」，都过一遍收敛逻辑。
 */
export function parseImportedDoc(text: string): ImportResult {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (raw === '') return { ok: false, error: '文件是空的' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }

  if (isLegacyProject(parsed)) {
    const doc = migrateFromWebBuilderV1(parsed)
    if (!doc) return { ok: false, error: '不是有效的 WebBuilder 项目' }
    return { ok: true, doc, migratedFromV1: true }
  }

  const doc = normalizeDoc(parsed)
  if (!doc) return { ok: false, error: '不是有效的项目数据（需要 v2 文档或 WebBuilder v1 项目）' }
  return { ok: true, doc, migratedFromV1: false }
}
