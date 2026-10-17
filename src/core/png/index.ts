/**
 * PNG 占位图（M7 素材生成用）。
 *
 * 为什么要自己写编码器：素材生成要产出「真实可显示的位图」，而 AI 返回的 SVG/外链
 * 都不能进导出（`safeUrl()` 只放行光栅 dataURL）。所以这里把「纯色/竖向渐变」的位图
 * 直接编码成 PNG —— 只用 zlib 里的 **stored（不压缩）块**，不引任何依赖，输出确定、
 * 可复现、可在 Node 与浏览器里生成。
 *
 * 全部是纯逻辑（不碰 canvas / document / Blob），所以放在 `core/`。
 */
import { crc32 } from '../zip'

/** PNG 文件签名 */
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface Rgb {
  r: number
  g: number
  b: number
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 标准 base64（自己实现，避免依赖 `btoa` / `Buffer`，core 保持环境无关） */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined
    out += BASE64_ALPHABET[first >> 2]
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    out += second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    out += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return out
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** zlib 容器 + stored（BTYPE=00）deflate 块：不做压缩，换来确定性与零依赖 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: number[] = [0x78, 0x01]
  let offset = 0
  do {
    const size = Math.min(65535, raw.length - offset)
    const final = offset + size >= raw.length
    parts.push(final ? 0x01 : 0x00)
    parts.push(size & 0xff, (size >> 8) & 0xff)
    const nlen = size ^ 0xffff
    parts.push(nlen & 0xff, (nlen >> 8) & 0xff)
    for (let index = 0; index < size; index += 1) parts.push(raw[offset + index])
    offset += size
  } while (offset < raw.length)
  const checksum = adler32(raw)
  parts.push((checksum >>> 24) & 0xff, (checksum >>> 16) & 0xff, (checksum >>> 8) & 0xff, checksum & 0xff)
  return new Uint8Array(parts)
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(4000, Math.round(value)))
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array([...type].map((char) => char.charCodeAt(0)))
  const body = new Uint8Array(head.length + data.length)
  body.set(head)
  body.set(data, head.length)
  const crc = crc32(body)
  const out = new Uint8Array(8 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(head, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc)
  return out
}

function encode(width: number, height: number, pixelAt: (row: number) => Rgb): Uint8Array {
  const w = clampSize(width)
  const h = clampSize(height)
  const raw = new Uint8Array(h * (1 + w * 3))
  let offset = 0
  for (let row = 0; row < h; row += 1) {
    const color = pixelAt(row)
    raw[offset] = 0 // 滤波类型 0（None）
    offset += 1
    for (let col = 0; col < w; col += 1) {
      raw[offset] = clampByte(color.r)
      raw[offset + 1] = clampByte(color.g)
      raw[offset + 2] = clampByte(color.b)
      offset += 3
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, w)
  view.setUint32(4, h)
  ihdr[8] = 8 // 位深
  ihdr[9] = 2 // 颜色类型：真彩色 RGB
  ihdr[10] = 0 // 压缩方法
  ihdr[11] = 0 // 滤波方法
  ihdr[12] = 0 // 非隔行
  const idat = zlibStored(raw)
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

/** 纯色 PNG */
export function createSolidPng(width: number, height: number, color: Rgb): Uint8Array {
  return encode(width, height, () => color)
}

/** 竖向渐变 PNG（素材候选的默认外观） */
export function createPlaceholderPng(width: number, height: number, from: Rgb, to: Rgb): Uint8Array {
  const h = clampSize(height)
  return encode(width, height, (row) => {
    const ratio = h <= 1 ? 0 : row / (h - 1)
    return {
      r: from.r + (to.r - from.r) * ratio,
      g: from.g + (to.g - from.g) * ratio,
      b: from.b + (to.b - from.b) * ratio,
    }
  })
}

/** 直接给 `<img src>` 用（`safeUrl()` 放行的光栅 dataURL） */
export function pngDataUrl(width: number, height: number, from: Rgb, to: Rgb): string {
  return `data:image/png;base64,${toBase64(createPlaceholderPng(width, height, from, to))}`
}
