import { describe, expect, it } from 'vitest'
import { buildTree, childrenOf, descendantsOf, flattenTree, isDescendantOf, nextOrder, normalizeFieldOrder } from '@/core/tree'
import { makeField, makeSchema } from './factories'

describe('buildTree', () => {
  it('根级按 order 升序派生，与扁平数组的存放顺序无关', () => {
    const late = makeField({ type: 'text', name: 'late', order: 2 })
    const early = makeField({ type: 'text', name: 'early', order: 0 })
    const middle = makeField({ type: 'text', name: 'middle', order: 1 })

    const tree = buildTree([late, early, middle])

    expect(tree.map(n => n.field.name)).toEqual(['early', 'middle', 'late'])
    expect(tree.map(n => n.children.length)).toEqual([0, 0, 0])
  })

  it('group 套 group 时层级正确', () => {
    const outer = makeField({ type: 'group', name: 'outer', order: 0 })
    const inner = makeField({ type: 'group', name: 'inner', parentId: outer.id, order: 1 })
    const leafA = makeField({ type: 'text', name: 'leafA', parentId: outer.id, order: 0 })
    const leafB = makeField({ type: 'text', name: 'leafB', parentId: inner.id, order: 0 })
    const rootText = makeField({ type: 'text', name: 'rootText', order: 1 })

    const tree = buildTree([leafB, rootText, inner, leafA, outer])

    expect(tree.map(n => n.field.name)).toEqual(['outer', 'rootText'])
    const outerNode = tree[0]
    expect(outerNode.children.map(n => n.field.name)).toEqual(['leafA', 'inner'])
    expect(outerNode.children[1].children.map(n => n.field.name)).toEqual(['leafB'])
    expect(tree[1].children).toEqual([])
  })

  it('父级不存在的孤儿字段不会被挂到树上（数据脏了也不崩）', () => {
    const orphan = makeField({ type: 'text', parentId: 'missing_group', order: 0 })
    const normal = makeField({ type: 'text', order: 0 })

    const tree = buildTree([orphan, normal])

    expect(tree.map(n => n.field.id)).toEqual([normal.id])
  })
})

describe('childrenOf / nextOrder', () => {
  it('childrenOf 返回同级的排好序字段，nextOrder 给出末尾下标', () => {
    const group = makeField({ type: 'group', order: 0 })
    const a = makeField({ type: 'text', parentId: group.id, order: 0 })
    const b = makeField({ type: 'text', parentId: group.id, order: 1 })
    const c = makeField({ type: 'text', parentId: group.id, order: 2 })
    const root = makeField({ type: 'text', order: 1 })
    const schema = makeSchema([group, root, c, a, b])

    expect(childrenOf(schema.fields, group.id).map(f => f.id)).toEqual([a.id, b.id, c.id])
    expect(nextOrder(schema.fields, group.id)).toBe(3)
    expect(childrenOf(schema.fields, null).map(f => f.id)).toEqual([group.id, root.id])
    expect(nextOrder(schema.fields, null)).toBe(2)
  })

  it('空集合时 nextOrder 为 0', () => {
    expect(nextOrder([], null)).toBe(0)
  })
})

describe('descendantsOf', () => {
  it('取到全部子孙（深度优先，父在子前），用于删除容器', () => {
    const outer = makeField({ type: 'group', order: 0 })
    const inner = makeField({ type: 'group', parentId: outer.id, order: 1 })
    const leafA = makeField({ type: 'text', parentId: outer.id, order: 0 })
    const leafB = makeField({ type: 'text', parentId: inner.id, order: 0 })
    const rootText = makeField({ type: 'text', order: 1 })
    const fields = [outer, inner, leafA, leafB, rootText]

    expect(descendantsOf(fields, outer.id).map(f => f.id)).toEqual([leafA.id, inner.id, leafB.id])
    expect(descendantsOf(fields, inner.id).map(f => f.id)).toEqual([leafB.id])
    expect(descendantsOf(fields, rootText.id)).toEqual([])
  })

  it('字段自己不算自己的子孙（自引用也不会死循环）', () => {
    const self = makeField({ type: 'group', order: 0, id: 'loop' })
    self.parentId = 'loop'

    expect(descendantsOf([self], 'loop').map(f => f.id)).not.toContain('loop')
  })
})

describe('flattenTree / normalizeFieldOrder', () => {
  it('flattenTree 按前序展开：父在子前，子级紧跟父级', () => {
    const outer = makeField({ type: 'group', order: 0 })
    const inner = makeField({ type: 'group', parentId: outer.id, order: 1 })
    const leafA = makeField({ type: 'text', parentId: outer.id, order: 0 })
    const leafB = makeField({ type: 'text', parentId: inner.id, order: 0 })
    const rootText = makeField({ type: 'text', order: 1 })

    const flat = flattenTree(buildTree([leafB, rootText, inner, leafA, outer]))

    expect(flat.map(f => f.id)).toEqual([outer.id, leafA.id, inner.id, leafB.id, rootText.id])
  })

  it('规范化后同一逻辑状态的数组顺序唯一，与原始摆放无关', () => {
    const group = makeField({ type: 'group', order: 0 })
    const rootText = makeField({ type: 'text', order: 1 })
    const child = makeField({ type: 'text', parentId: group.id, order: 0 })

    expect(normalizeFieldOrder([child, rootText, group]).map(f => f.id)).toEqual([group.id, child.id, rootText.id])
    expect(normalizeFieldOrder([rootText, group, child]).map(f => f.id)).toEqual([group.id, child.id, rootText.id])
  })

  it('父级已被删除的孤儿字段排在末尾，顺序唯一确定', () => {
    const orphan = makeField({ type: 'text', parentId: 'gone', order: 5 })
    const normal = makeField({ type: 'text', order: 0 })

    expect(normalizeFieldOrder([orphan, normal]).map(f => f.id)).toEqual([normal.id, orphan.id])
    expect(normalizeFieldOrder([normal, orphan]).map(f => f.id)).toEqual([normal.id, orphan.id])
  })
})

describe('isDescendantOf', () => {
  it('能判断跨层级的祖先关系', () => {
    const outer = makeField({ type: 'group', order: 0 })
    const inner = makeField({ type: 'group', parentId: outer.id, order: 0 })
    const leaf = makeField({ type: 'text', parentId: inner.id, order: 0 })
    const other = makeField({ type: 'text', order: 1 })
    const fields = [outer, inner, leaf, other]

    expect(isDescendantOf(fields, outer.id, leaf.id)).toBe(true)
    expect(isDescendantOf(fields, inner.id, leaf.id)).toBe(true)
    expect(isDescendantOf(fields, leaf.id, outer.id)).toBe(false)
    expect(isDescendantOf(fields, outer.id, other.id)).toBe(false)
    expect(isDescendantOf(fields, outer.id, outer.id)).toBe(false)
  })

  it('祖先链断裂（父级已被删除）时返回 false', () => {
    const orphan = makeField({ type: 'text', parentId: 'gone', order: 0 })

    expect(isDescendantOf([orphan], 'gone', orphan.id)).toBe(false)
  })
})
