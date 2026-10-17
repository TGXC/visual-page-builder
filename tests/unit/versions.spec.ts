import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_VERSIONS,
  VERSIONS_KEY,
  clearVersions,
  loadVersions,
  removeVersion,
  restoreVersion,
  saveVersion,
  versionSummaryOf,
} from '@/core/versions'
import { makeDoc } from './factories'

afterEach(() => {
  localStorage.clear()
})

describe('M8 版本历史（core/versions，纯逻辑）', () => {
  it('存一个带名字的版本，按最新在前返回', () => {
    localStorage.clear()
    const doc = makeDoc()
    const list = saveVersion(doc, '改版前', 1000)
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe('改版前')
    expect(list[0]!.at).toBe(1000)
    expect(loadVersions()[0]!.name).toBe('改版前')

    const second = saveVersion(doc, '改版后', 2000)
    expect(second.map((item) => item.name)).toEqual(['改版后', '改版前'])
  })

  it('名字为空回落「未命名版本」，首尾空白被去掉', () => {
    localStorage.clear()
    expect(saveVersion(makeDoc(), '   ', 1)[0]!.name).toBe('未命名版本')
    expect(saveVersion(makeDoc(), '  首页改版  ', 2)[0]!.name).toBe('首页改版')
  })

  it(`最多保留 ${MAX_VERSIONS} 个版本，超出丢最老的`, () => {
    localStorage.clear()
    for (let index = 0; index < MAX_VERSIONS + 5; index += 1) {
      saveVersion(makeDoc(), `v${index}`, index)
    }
    const list = loadVersions()
    expect(list.length).toBe(MAX_VERSIONS)
    expect(list[0]!.name).toBe(`v${MAX_VERSIONS + 4}`)
    expect(list.some((item) => item.name === 'v0')).toBe(false)
  })

  it('回滚拿到的文档与存进去时逐字节一致（JSON 相同）', () => {
    localStorage.clear()
    const doc = makeDoc()
    const [entry] = saveVersion(doc, '改版前', 1000)
    const restored = restoreVersion(entry!.id)
    expect(restored).not.toBeNull()
    expect(JSON.stringify(restored)).toBe(JSON.stringify(doc))
    expect(restored).not.toBe(doc) // 是副本，改回滚结果不会污染存档
  })

  it('删除单个版本 / 清空 / 未知 id 返回 null', () => {
    localStorage.clear()
    const [first] = saveVersion(makeDoc(), '一', 1)
    saveVersion(makeDoc(), '二', 2)
    expect(removeVersion(first!.id).map((item) => item.name)).toEqual(['二'])
    expect(restoreVersion('nope')).toBeNull()
    expect(clearVersions()).toEqual([])
    expect(loadVersions()).toEqual([])
  })

  it('坏存档与 localStorage 不可用时静默降级成空表', () => {
    localStorage.setItem(VERSIONS_KEY, '{oops')
    expect(loadVersions()).toEqual([])
    localStorage.setItem(VERSIONS_KEY, '{"a":1}')
    expect(loadVersions()).toEqual([])
    expect(saveVersion(makeDoc(), '好的', 1).length).toBe(1)
    expect(loadVersions()[0]!.name).toBe('好的')
  })

  it('版本摘要给出页数与元素数（面板列表用）', () => {
    const doc = makeDoc()
    expect(versionSummaryOf({ id: 'v', name: 'x', at: 0, doc })).toMatch(/1 页/)
  })
})
