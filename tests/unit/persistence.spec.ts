import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTOSAVE_DELAY,
  STORAGE_KEY,
  clearDoc,
  isStorageAvailable,
  loadDoc,
  saveDoc,
  serializeDoc,
} from '@/core/persistence'
import { docWithNodes, makeNode } from './factories'
import { normalizeDoc } from '@/core/schema/normalize'

function doc() {
  return docWithNodes([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'a', parentId: 'root' })])
}

describe('persistence：自动保存与恢复', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('常量稳定（存档键与防抖时间）', () => {
    expect(STORAGE_KEY).toBe('studio:doc:v2')
    expect(AUTOSAVE_DELAY).toBe(400)
    expect(isStorageAvailable()).toBe(true)
  })

  it('没有存档时返回 null', () => {
    expect(loadDoc()).toBeNull()
  })

  it('存进去再读出来是同一份文档，但不是同一个对象', () => {
    const source = doc()
    expect(saveDoc(source)).toBe(true)
    const loaded = loadDoc()
    expect(loaded).not.toBeNull()
    // 读回来会过收敛层，所以对照的是「规范化之后的源文档」
    const expected = normalizeDoc(JSON.parse(serializeDoc(source)))
    expect(serializeDoc(loaded as never)).toBe(serializeDoc(expected as never))
    expect(loaded).not.toBe(source)
  })

  it('读回来会过收敛层：脏存档被修正而不是直接崩', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        id: 'doc_dirty',
        name: '脏文档',
        activePageId: 'nope',
        pages: [
          {
            id: 'p1',
            name: '页',
            root: 'r',
            viewport: { w: 99999, h: -5 },
            nodes: {
              r: { id: 'r', type: 'frame', parentId: null, order: 0 },
              bad: { id: 'bad', type: 'not-real', parentId: 'ghost', order: 'x' },
            },
          },
        ],
      }),
    )
    const loaded = loadDoc()
    expect(loaded).not.toBeNull()
    const page = loaded?.pages[0]
    expect(page?.viewport.w).toBeLessThanOrEqual(10000)
    expect(page?.viewport.h).toBeGreaterThanOrEqual(200)
    expect(page?.nodes.bad.type).toBe('rect')
    expect(page?.nodes.bad.parentId).toBe('r')
    expect(loaded?.activePageId).toBe('p1')
  })

  it('坏 JSON 与版本不对都当作没有存档', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json')
    expect(loadDoc()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, pages: [] }))
    expect(loadDoc()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, pages: 'nope' }))
    expect(loadDoc()).toBeNull()
  })

  it('配额满时静默失败而不是抛异常', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(saveDoc(doc())).toBe(false)
    spy.mockRestore()
  })

  it('clearDoc 清掉存档', () => {
    saveDoc(doc())
    clearDoc()
    expect(loadDoc()).toBeNull()
  })
})
