import { describe, expect, it } from 'vitest'
import { createId } from '@/core/id'

describe('createId', () => {
  it('默认前缀是 f，格式为 前缀_随机串', () => {
    const id = createId()
    expect(id.startsWith('f_')).toBe(true)
    expect(id).toMatch(/^f_[A-Za-z0-9_-]{10}$/)
  })

  it('可以指定前缀，便于区分字段与分组', () => {
    expect(createId('group')).toMatch(/^group_[A-Za-z0-9_-]{10}$/)
    expect(createId('rule')).toMatch(/^rule_[A-Za-z0-9_-]{10}$/)
  })

  it('连续生成 1000 个不重复（id 稳定，不会随删除排序失效）', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(createId())

    expect(ids.size).toBe(1000)
  })
})
