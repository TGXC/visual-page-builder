import { describe, expect, it } from 'vitest'
import { normalizeDoc } from '@/core/schema/normalize'
import { MAX_SHARE_LENGTH, SHARE_PREFIX, decodeDoc, encodeDoc, shareUrl } from '@/core/share'
import { makeDoc, makeNode, makePage } from './factories'

function richDoc() {
  const page = makePage({
    id: 'page_1',
    name: '首页 🎉',
    nodes: {
      root: makeNode({ id: 'root', type: 'frame' }),
      t1: makeNode({ id: 't1', type: 'text', parentId: 'root', props: { text: '你好，世界' } }),
    },
  })
  return makeDoc({ name: '分享测试', pages: [page], activePageId: 'page_1' })
}

describe('M8 分享链接（core/share，纯逻辑）', () => {
  it('文档 → 链接片段 → 文档：内容逐字节一致，中文与 emoji 不丢', () => {
    const doc = richDoc()
    const encoded = encodeDoc(doc)
    expect(encoded.startsWith(SHARE_PREFIX)).toBe(true)
    const back = decodeDoc(encoded)
    expect(back).not.toBeNull()
    // 收敛层是规范化过的（键序统一），所以和 normalizeDoc 的结果逐字节一致；
    // 原始 doc 因为键序不同可能不一样，这里只断言内容不丢。
    expect(JSON.stringify(back)).toBe(JSON.stringify(normalizeDoc(doc)))
    expect(JSON.stringify(back)).toContain('你好，世界')
    expect(JSON.stringify(back)).toContain('🎉')
  })

  it('片段里只出现 URL 安全字符（base64url，没有 + / =）', () => {
    const encoded = encodeDoc(richDoc()).slice(SHARE_PREFIX.length)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('解码容忍带/不带前缀与多余的 # / 空格，也吃完整地址', () => {
    const encoded = encodeDoc(richDoc())
    const body = encoded.slice(SHARE_PREFIX.length)
    expect(decodeDoc(body)).not.toBeNull()
    expect(decodeDoc(`#${encoded}`)).not.toBeNull()
    expect(decodeDoc(`  ${encoded}  `)).not.toBeNull()
    // 面板里用户粘的通常是整条链接
    expect(decodeDoc(shareUrl(richDoc(), 'https://example.com/studio'))).not.toBeNull()
    expect(decodeDoc(`https://example.com/studio${encoded}#extra`)).not.toBeNull()
  })

  it('坏输入一律返回 null（空、乱码、非 JSON、形状不对）', () => {
    expect(decodeDoc('')).toBeNull()
    expect(decodeDoc('#doc=')).toBeNull()
    expect(decodeDoc('#doc=!!!!')).toBeNull()
    expect(decodeDoc('#doc=YWJj')).toBeNull() // 'abc'：不是 JSON
    expect(decodeDoc(`#doc=${btoa('"just a string"').replace(/=+$/, '')}`)).toBeNull()
    // `{}` 会收敛成一份默认文档（不算坏输入），数组才是拒绝的
    expect(decodeDoc(`#doc=${btoa('[]').replace(/=+$/, '')}`)).toBeNull()
    expect(decodeDoc('#doc=%')).toBeNull()
  })

  it('shareUrl() 拼出完整地址，过长时返回空串（浏览器地址栏放不下）', () => {
    const doc = richDoc()
    expect(shareUrl(doc, 'https://example.com/studio')).toBe(
      `https://example.com/studio${encodeDoc(doc)}`,
    )
    expect(shareUrl(doc, 'https://example.com/studio#')).toBe(
      `https://example.com/studio${encodeDoc(doc)}`,
    )

    const huge = makeDoc({
      pages: [
        makePage({
          id: 'page_1',
          nodes: Object.fromEntries([
            ['root', makeNode({ id: 'root', type: 'frame' })],
            ...Array.from({ length: 400 }, (_item, index) => [
              `n${index}`,
              makeNode({ id: `n${index}`, type: 'text', parentId: 'root', props: { text: '很长的文案'.repeat(20) } }),
            ]),
          ]),
        }),
      ],
    })
    const encoded = encodeDoc(huge)
    expect(encoded.length).toBeGreaterThan(MAX_SHARE_LENGTH)
    expect(shareUrl(huge, 'https://example.com/studio')).toBe('')
  })
})
