import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERSIST_DELAY, STORAGE_KEY, clearSchema, loadSchema, saveSchema } from '@/stores/persist'
import { normalizeSchema } from '@/core/schema'
import { demoSchema } from '@/data/demoSchema'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('持久化协议', () => {
  it('键名带版本号，防抖 300ms', () => {
    expect(STORAGE_KEY).toBe('form-builder:v1:schema')
    expect(PERSIST_DELAY).toBe(300)
  })

  it('没有存档返回 null', () => {
    expect(loadSchema()).toBeNull()
  })

  it('坏 JSON / 版本不对 / fields 不是数组一律当作没有存档', () => {
    localStorage.setItem(STORAGE_KEY, '{ 不是 json')
    expect(loadSchema()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, fields: [] }))
    expect(loadSchema()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, fields: 'x' }))
    expect(loadSchema()).toBeNull()
  })

  it('写进去再读出来，内容一致但不是同一个对象', () => {
    saveSchema(demoSchema)
    const loaded = loadSchema()
    expect(loaded).toEqual(demoSchema)
    expect(loaded).not.toBe(demoSchema)
  })

  it('读档时走 normalizeSchema：脏存档也被收敛成规范形态', () => {
    const dirty = {
      version: 1,
      id: 'draft_form',
      name: '脏表单',
      fields: [
        { id: 'a', type: '魔法字段', order: 5 },
        { id: 'b', type: 'text', name: 'b', parentId: 'ghost', order: 5 },
      ],
      settings: {},
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dirty))
    const loaded = loadSchema()
    expect(loaded).toEqual(normalizeSchema(dirty))
    expect(loaded?.fields[0]?.type).toBe('text')
    expect(loaded?.fields[1]?.parentId).toBeNull()
    expect(loaded?.fields.map(f => f.order)).toEqual([0, 1])
  })

  it('配额满时不抛，编辑不该被打断', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveSchema(demoSchema)).not.toThrow()
  })

  it('clearSchema 之后读不到', () => {
    saveSchema(demoSchema)
    clearSchema()
    expect(loadSchema()).toBeNull()
  })
})
