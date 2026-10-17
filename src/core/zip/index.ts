/**
 * 最小 ZIP 写入器（M5 的「整站打包」用）。
 *
 * 为什么自己写：`.zip` 是站点分发的通用容器，但仓库约定「不引第三方依赖」，
 * 而 ZIP 的 stored（不压缩）模式只需要 CRC32 + 三段固定结构，够用且可单测。
 * 站点文件都是文本，压缩收益有限，所以刻意不做 deflate。
 *
 * 结构：每个条目 = 本地文件头 + 原始数据；最后是中央目录 + EOCD（结尾记录）。
 * 文件名按 UTF-8 编码，并在通用位标记里置 0x0800（语言编码标志），中文文件名才能被正确解读。
 */

export interface ZipEntry {
  /** 包内路径，用 `/` 分隔，例如 `pages/about.html` */
  path: string
  content: string
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50

let crcTable: Uint32Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const next = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    next[index] = value >>> 0
  }
  crcTable = next
  return next
}

/** 标准 CRC-32（IEEE 802.3），ZIP 每个条目都要带 */
export function crc32(bytes: Uint8Array): number {
  const lookup = table()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = lookup[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/**
 * 把若干文本文件打成一个 ZIP。时间戳固定为 0（可复现：同一份输入永远得到同一串字节，
 * 便于快照测试与增量比较）。
 */
/** 打包成 ZIP（stored 存储、不压缩；返回 `Uint8Array<ArrayBuffer>` 以便直接塞进 `Blob`） */
export function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = utf8(entry.path)
    const data = encoder.encode(entry.content)
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, LOCAL_HEADER, true)
    localView.setUint16(4, 20, true) // 需要的版本 2.0
    localView.setUint16(6, 0x0800, true) // UTF-8 文件名
    localView.setUint16(8, 0, true) // 不压缩
    localView.setUint16(10, 0, true) // 时间
    localView.setUint16(12, 0, true) // 日期
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    localView.setUint16(28, 0, true)
    local.set(name, 30)
    parts.push(local, data)

    const entryCentral = new Uint8Array(46 + name.length)
    const centralView = new DataView(entryCentral.buffer)
    centralView.setUint32(0, CENTRAL_HEADER, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    entryCentral.set(name, 46)
    central.push(entryCentral)

    offset += local.length + data.length
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, EOCD, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true)

  const total = offset + centralSize + end.length
  const output = new Uint8Array(total)
  let cursor = 0
  for (const part of [...parts, ...central, end]) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}
