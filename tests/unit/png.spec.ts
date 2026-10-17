import { describe, expect, it } from 'vitest'
import { crc32 } from '@/core/zip'
import {
  PNG_SIGNATURE,
  createPlaceholderPng,
  createSolidPng,
  pngDataUrl,
  toBase64,
} from '@/core/png'
import { safeUrl } from '@/core/html'

/** 独立解包：只认我们写出的 stored（BTYPE=00）deflate 块，用来反证像素数据真的在里面 */
function inflateStored(bytes: Uint8Array): Uint8Array {
  expect(bytes[0]).toBe(0x78)
  expect(bytes[1]).toBe(0x01)
  let offset = 2
  const out: number[] = []
  for (;;) {
    const header = bytes[offset]
    const final = (header & 0x01) === 1
    const type = (header >> 1) & 0x03
    expect(type).toBe(0)
    const len = bytes[offset + 1] | (bytes[offset + 2] << 8)
    const nlen = bytes[offset + 3] | (bytes[offset + 4] << 8)
    expect(nlen ^ 0xffff).toBe(len)
    offset += 5
    for (let index = 0; index < len; index += 1) out.push(bytes[offset + index])
    offset += len
    if (final) break
  }
  // 4 字节 adler32 校验和
  return new Uint8Array(out)
}

interface Chunk {
  type: string
  data: Uint8Array
  crc: number
}

function readChunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Chunk[] = []
  let offset = 8
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8))
    const data = png.slice(offset + 8, offset + 8 + length)
    const crc = view.getUint32(offset + 8 + length)
    chunks.push({ type, data, crc })
    offset += 12 + length
  }
  return chunks
}

function chunkCrc(type: string, data: Uint8Array): number {
  const head = new Uint8Array([...type].map((char) => char.charCodeAt(0)))
  const merged = new Uint8Array(head.length + data.length)
  merged.set(head)
  merged.set(data, head.length)
  return crc32(merged)
}

describe('M7 PNG 占位图（core/png，纯逻辑）', () => {
  it('输出标准 PNG 签名与 IHDR/IDAT/IEND 三段结构', () => {
    const png = createSolidPng(4, 3, { r: 30, g: 64, b: 255 })
    expect([...png.slice(0, 8)]).toEqual([...PNG_SIGNATURE])
    const chunks = readChunks(png)
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const ihdr = chunks[0].data
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
    expect(view.getUint32(0)).toBe(4)
    expect(view.getUint32(4)).toBe(3)
    expect(ihdr[8]).toBe(8) // 位深
    expect(ihdr[9]).toBe(2) // 真彩色 RGB
  })

  it('每个 chunk 的 CRC-32 与长度前缀都对得上', () => {
    const png = createSolidPng(2, 2, { r: 255, g: 255, b: 255 })
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    let offset = 8
    for (const chunk of readChunks(png)) {
      expect(view.getUint32(offset)).toBe(chunk.data.length)
      expect(chunk.crc).toBe(chunkCrc(chunk.type, chunk.data))
      offset += 12 + chunk.data.length
    }
  })

  it('IDAT 解出来就是 h 行「滤波字节 0 + w×3 像素」，颜色与入参一致', () => {
    const png = createSolidPng(3, 2, { r: 10, g: 20, b: 30 })
    const idat = readChunks(png).find((chunk) => chunk.type === 'IDAT')
    expect(idat).toBeDefined()
    const raw = inflateStored(idat!.data)
    expect(raw.length).toBe(2 * (1 + 3 * 3))
    for (let row = 0; row < 2; row += 1) {
      const start = row * (1 + 3 * 3)
      expect(raw[start]).toBe(0)
      for (let col = 0; col < 3; col += 1) {
        const pixel = start + 1 + col * 3
        expect([raw[pixel], raw[pixel + 1], raw[pixel + 2]]).toEqual([10, 20, 30])
      }
    }
  })

  it('渐变占位图逐行颜色不同，且首末行等于两端颜色', () => {
    const png = createPlaceholderPng(2, 4, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    const idat = readChunks(png).find((chunk) => chunk.type === 'IDAT')
    const raw = inflateStored(idat!.data)
    const rowOf = (row: number): number[] => {
      const start = row * (1 + 3 * 2)
      return [raw[start + 1], raw[start + 2], raw[start + 3]]
    }
    expect(rowOf(0)).toEqual([0, 0, 0])
    expect(rowOf(3)).toEqual([255, 255, 255])
    expect(rowOf(1)[0]).toBeGreaterThan(rowOf(0)[0])
    expect(rowOf(1)[0]).toBeLessThan(rowOf(3)[0])
  })

  it('同样的入参给出同样的字节（可复现），尺寸变化会改变字节', () => {
    const first = createSolidPng(5, 5, { r: 1, g: 2, b: 3 })
    const second = createSolidPng(5, 5, { r: 1, g: 2, b: 3 })
    const other = createSolidPng(6, 5, { r: 1, g: 2, b: 3 })
    expect([...first]).toEqual([...second])
    expect([...first]).not.toEqual([...other])
  })

  it('尺寸被夹进取整后的正整数范围，0 或负数不产生非法 PNG', () => {
    const png = createSolidPng(0, -3, { r: 0, g: 0, b: 0 })
    const ihdr = readChunks(png)[0].data
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
    expect(view.getUint32(0)).toBeGreaterThanOrEqual(1)
    expect(view.getUint32(4)).toBeGreaterThanOrEqual(1)
  })

  it('toBase64 与小样本对照（含补位分支）', () => {
    expect(toBase64(new Uint8Array([]))).toBe('')
    expect(toBase64(new Uint8Array([0x4d]))).toBe('TQ==')
    expect(toBase64(new Uint8Array([0x4d, 0x61]))).toBe('TWE=')
    expect(toBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe('TWFu')
    expect(toBase64(new Uint8Array([0x00, 0xff, 0x10, 0x80]))).toBe('AP8QgA==')
  })

  it('pngDataUrl 产出的地址能过 safeUrl（M5 的出图白名单）', () => {
    const url = pngDataUrl(8, 8, { r: 59, g: 130, b: 246 }, { r: 15, g: 23, b: 42 })
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    expect(safeUrl(url)).toBe(url)
    expect(safeUrl(url.replace('data:image/png', 'data:image/svg+xml'))).toBe('')
  })

  it('颜色分量越界或非有限数被夹到 0–255', () => {
    const png = createSolidPng(1, 1, { r: Number.NaN, g: -20, b: 400 })
    const idat = readChunks(png).find((chunk) => chunk.type === 'IDAT')
    const raw = inflateStored(idat!.data)
    expect([raw[0], raw[1], raw[2], raw[3]]).toEqual([0, 0, 0, 255])
  })

  it('非有限尺寸回落到 1×1，而不是写出 NaN 宽高', () => {
    const png = createSolidPng(Number.NaN, Number.POSITIVE_INFINITY, { r: 1, g: 1, b: 1 })
    const ihdr = readChunks(png)[0].data
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
    expect(view.getUint32(0)).toBe(1)
    expect(view.getUint32(4)).toBe(1)
  })

  it('超过 65535 字节的像素数据自动切成多个 stored 块（末块置 final 位）', () => {
    const png = createPlaceholderPng(200, 200, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    const idat = readChunks(png).find((chunk) => chunk.type === 'IDAT')
    const raw = inflateStored(idat!.data)
    expect(raw.length).toBe(200 * (1 + 200 * 3))
    // 每块最多 65535 字节，120200 字节至少 2 块，连块头一起必然超过单块上限
    expect(idat!.data.length).toBeGreaterThan(65535 + 5)
    expect(raw[raw.length - 3]).toBe(255)
  })
})
