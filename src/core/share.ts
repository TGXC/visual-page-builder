import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { parseSchemaJson, toJsonText } from './schema'
import type { FormSchema } from './types'

/**
 * 分享链接：把整份 schema 压进 query，不需要后端。
 * 代价是长度——大多数浏览器和聊天工具的 URL 上限在 2000 字符附近，
 * 所以这里给一个上限常量，超了由界面提示改用导出 JSON（D20）。
 */
export const SHARE_URL_LIMIT = 2000

export const SHARE_QUERY_KEY = 'd'

export function encodeSchema(schema: FormSchema): string {
  return compressToEncodedURIComponent(toJsonText(schema))
}

/** 解不开 / 内容不是表单都返回 null，调用方显示「链接已损坏」 */
export function decodeSchema(encoded: string): FormSchema | null {
  if (!encoded) return null
  let json: string | null = null
  try {
    json = decompressFromEncodedURIComponent(encoded)
  } catch {
    return null
  }
  if (json === null || json === '') return null
  const result = parseSchemaJson(json)
  return result.ok ? result.schema : null
}

export function buildShareUrl(schema: FormSchema, origin: string, path = '/share'): string {
  return `${origin}${path}?${SHARE_QUERY_KEY}=${encodeSchema(schema)}`
}

export function isTooLong(url: string, limit = SHARE_URL_LIMIT): boolean {
  return url.length > limit
}
