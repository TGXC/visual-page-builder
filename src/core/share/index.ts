/**
 * M8 分享（功能文档 L7「分享/发布」：本地导出 + 可选上传，支持预览链接）。
 *
 * 这里只做**纯本地**那半：把文档压成一个 URL 片段 `#doc=<base64url>`，
 * 打开带这个片段的地址就能还原文档（store 在启动时读一次）。
 * 不做上传 —— 没有托管账号，PLAN/README 如实标注（D54）。
 *
 * 编码路径：`JSON.stringify(doc)` → `encodeURIComponent`（转成 ASCII）→ base64 → base64url。
 * 这样中文/emoji 不依赖 `btoa` 的 latin1 限制，也不需要 `TextEncoder`。
 */
import { normalizeDoc } from '../schema/normalize'
import type { Doc } from '../schema/types'

export const SHARE_PREFIX = '#doc='
/** 超过这个长度的链接直接不生成（Chrome 地址栏上限约 32k，留足余量给站点路径与查询串） */
export const MAX_SHARE_LENGTH = 12_000

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Of(ascii: string): string {
  let result = ''
  for (let index = 0; index < ascii.length; index += 3) {
    const first = ascii.charCodeAt(index)
    const second = index + 1 < ascii.length ? ascii.charCodeAt(index + 1) : Number.NaN
    const third = index + 2 < ascii.length ? ascii.charCodeAt(index + 2) : Number.NaN
    const hasSecond = !Number.isNaN(second)
    const hasThird = !Number.isNaN(third)
    const combined = (first << 16) | ((hasSecond ? second : 0) << 8) | (hasThird ? third : 0)
    result += BASE64_ALPHABET[(combined >> 18) & 63]
    result += BASE64_ALPHABET[(combined >> 12) & 63]
    result += hasSecond ? BASE64_ALPHABET[(combined >> 6) & 63] : '='
    result += hasThird ? BASE64_ALPHABET[combined & 63] : '='
  }
  return result
}

function asciiOf(base64: string): string {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  let result = ''
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4)
    const values = [...chunk].map((char) => BASE64_ALPHABET.indexOf(char))
    const bytes = [
      (values[0]! << 2) | ((values[1] ?? 0) >> 4),
      ((values[1] ?? 0) & 15) << 4 | ((values[2] ?? 0) >> 2),
      ((values[2] ?? 0) & 3) << 6 | (values[3] ?? 0),
    ]
    result += String.fromCharCode(...bytes.slice(0, chunk.length - 1))
  }
  return result
}

function toUrlSafe(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromUrlSafe(text: string): string {
  const restored = text.replace(/-/g, '+').replace(/_/g, '/')
  const padding = restored.length % 4 === 0 ? '' : '='.repeat(4 - (restored.length % 4))
  return restored + padding
}

/** 文档 → `#doc=<base64url>`（可复现：同一份文档给出同一个片段） */
export function encodeDoc(doc: Doc): string {
  return `${SHARE_PREFIX}${toUrlSafe(base64Of(encodeURIComponent(JSON.stringify(doc))))}`
}

/** 片段 → 文档；任何一步失败都返回 null（不抛），成功的结果一定过了 `normalizeDoc()` */
export function decodeDoc(input: string): Doc | null {
  // 既能吃 `#doc=…` 片段，也能吃完整地址（面板里用户大概率粘的是整条链接）
  const at = input.indexOf(SHARE_PREFIX)
  // 片段后可能还跟着别的东西（例如 `…&x=1`、额外的 `#`），base64url 字母表里没有这些字符，截掉
  const raw = (at >= 0 ? input.slice(at + SHARE_PREFIX.length) : input.trim().replace(/^#+/, '')).split('#')[0]!
  const body = (raw.startsWith('doc=') ? raw.slice('doc='.length) : raw).split('&')[0]!
  if (body === '') return null
  try {
    const ascii = asciiOf(fromUrlSafe(body))
    if (!ascii.startsWith('%7B') && !ascii.trimStart().startsWith('{')) return null
    const json = decodeURIComponent(ascii)
    const parsed: unknown = JSON.parse(json)
    return normalizeDoc(parsed)
  } catch {
    return null
  }
}

/** 完整分享地址；过长返回空串（界面据此提示「改用导出文件」） */
export function shareUrl(doc: Doc, base: string): string {
  const encoded = encodeDoc(doc)
  if (encoded.length > MAX_SHARE_LENGTH) return ''
  return `${base.replace(/#.*$/, '')}${encoded}`
}
