import { describe, expect, it } from 'vitest'
import {
  SHARE_QUERY_KEY,
  SHARE_URL_LIMIT,
  buildShareUrl,
  decodeSchema,
  encodeSchema,
  isTooLong,
} from '@/core/share'
import { toJsonText } from '@/core/schema'
import { demoSchema } from '@/data/demoSchema'
import type { FormSchema } from '@/core/types'
import { makeField, makeSchema } from './factories'

/** 高熵长表单：用真实长度的表单证明「分享链接写不下」这条提示不是摆设 */
function longSchema(count: number): FormSchema {
  const fields = Array.from({ length: count }, (_, i) => {
    const label = Array.from({ length: 40 }, (_, j) => String.fromCharCode(97 + ((i * 31 + j * 17) % 26))).join('')
    return makeField({ id: `f_${i}`, type: 'text', name: `field_${i}`, label: `${label}${i}`, order: i })
  })
  return makeSchema(fields)
}

describe('encodeSchema / decodeSchema', () => {
  it('往返后与原始 schema 完全一致', () => {
    const encoded = encodeSchema(demoSchema)
    expect(decodeSchema(encoded)).toEqual(demoSchema)
  })

  it('压缩结果比原文短（所以链接才塞得下）', () => {
    const encoded = encodeSchema(demoSchema)
    expect(encoded.length).toBeLessThan(toJsonText(demoSchema).length)
  })

  it('空串 / 垃圾串 / 解出来不是表单的串都返回 null', () => {
    expect(decodeSchema('')).toBeNull()
    expect(decodeSchema('这不是压缩数据')).toBeNull()
    expect(decodeSchema('N4IgLgngDgpiBcIA')).toBeNull()
  })
})

describe('buildShareUrl', () => {
  it('把压缩后的 schema 放进 query，能被解回来', () => {
    const url = buildShareUrl(demoSchema, 'https://form.example.com')
    expect(url.startsWith(`https://form.example.com/share?${SHARE_QUERY_KEY}=`)).toBe(true)
    const encoded = url.slice(url.indexOf(`${SHARE_QUERY_KEY}=`) + SHARE_QUERY_KEY.length + 1)
    expect(decodeSchema(encoded)).toEqual(demoSchema)
  })

  it('可以指定路径', () => {
    expect(buildShareUrl(demoSchema, 'http://localhost:5173', '/preview').startsWith('http://localhost:5173/preview?d=')).toBe(
      true,
    )
  })

  it('demo 表单的链接没超上限，长表单会超', () => {
    const demoUrl = buildShareUrl(demoSchema, 'https://form.example.com')
    expect(isTooLong(demoUrl)).toBe(false)
    expect(isTooLong(buildShareUrl(longSchema(120), 'https://form.example.com'))).toBe(true)
  })
})

describe('isTooLong', () => {
  it('默认上限 2000，边界是开区间', () => {
    expect(SHARE_URL_LIMIT).toBe(2000)
    expect(isTooLong('x'.repeat(2000))).toBe(false)
    expect(isTooLong('x'.repeat(2001))).toBe(true)
  })

  it('可以传自定义上限', () => {
    expect(isTooLong('x'.repeat(11), 10)).toBe(true)
    expect(isTooLong('x'.repeat(10), 10)).toBe(false)
  })
})
