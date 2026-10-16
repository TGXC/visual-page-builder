import { describe, expect, it } from 'vitest'
import {
  childrenOf,
  descendantsOf,
  flattenTree,
  isDescendantOf,
  nextOrder,
  normalizeNodeOrder,
  siblingIds,
  subtreeIds,
  treeOf,
} from '@/core/tree'
import { makeNode, makeNodes, ordersOf } from './factories'

const nodes = makeNodes([
  makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
  makeNode({ id: 'a', parentId: 'root', order: 2 }),
  makeNode({ id: 'b', parentId: 'root', order: 0 }),
  makeNode({ id: 'c', parentId: 'root', order: 1 }),
  makeNode({ id: 'b1', parentId: 'b', order: 0 }),
  makeNode({ id: 'b2', parentId: 'b', order: 1 }),
  makeNode({ id: 'c1', parentId: 'c', order: 0 }),
])

describe('childrenOf / siblingIds / nextOrder', () => {
  it('同级按 order 升序，与对象键顺序无关', () => {
    expect(childrenOf(nodes, 'root').map((node) => node.id)).toEqual(['b', 'c', 'a'])
    expect(childrenOf(nodes, 'b').map((node) => node.id)).toEqual(['b1', 'b2'])
    expect(childrenOf(nodes, null).map((node) => node.id)).toEqual(['root'])
  })

  it('order 相同时按 id 兜底，保证顺序稳定', () => {
    const tied = makeNodes([
      makeNode({ id: 'z', parentId: 'p', order: 0 }),
      makeNode({ id: 'm', parentId: 'p', order: 0 }),
      makeNode({ id: 'a', parentId: 'p', order: 0 }),
    ])
    expect(childrenOf(tied, 'p').map((node) => node.id)).toEqual(['a', 'm', 'z'])
  })

  it('没有子节点时返回空数组', () => {
    expect(childrenOf(nodes, 'b1')).toEqual([])
    expect(childrenOf(nodes, 'ghost')).toEqual([])
    expect(siblingIds(nodes, 'b1')).toEqual([])
  })

  it('siblingIds 只给同级 id', () => {
    expect(siblingIds(nodes, 'root')).toEqual(['b', 'c', 'a'])
    expect(siblingIds(nodes, null)).toEqual(['root'])
  })

  it('nextOrder 是同级最大 order + 1，空集合为 0', () => {
    expect(nextOrder(nodes, 'root')).toBe(3)
    expect(nextOrder(nodes, 'b')).toBe(2)
    expect(nextOrder(nodes, 'zzz')).toBe(0)
  })
})

describe('descendantsOf / isDescendantOf / subtreeIds', () => {
  it('前序展开子孙且不含自己', () => {
    expect(descendantsOf(nodes, 'root').map((node) => node.id)).toEqual(['b', 'b1', 'b2', 'c', 'c1', 'a'])
    expect(descendantsOf(nodes, 'b').map((node) => node.id)).toEqual(['b1', 'b2'])
    expect(descendantsOf(nodes, 'b1')).toEqual([])
    expect(descendantsOf(nodes, 'ghost')).toEqual([])
  })

  it('数据里有环也不会死循环', () => {
    const cyclic = makeNodes([
      makeNode({ id: 'x', parentId: 'y' }),
      makeNode({ id: 'y', parentId: 'x' }),
      makeNode({ id: 'z', parentId: 'x' }),
    ])
    expect(descendantsOf(cyclic, 'x').map((node) => node.id)).toEqual(['y', 'z'])
  })

  it('isDescendantOf 跨层级判断，自比为假，父链断为假', () => {
    expect(isDescendantOf(nodes, 'root', 'b1')).toBe(true)
    expect(isDescendantOf(nodes, 'b', 'b1')).toBe(true)
    expect(isDescendantOf(nodes, 'b1', 'b')).toBe(false)
    expect(isDescendantOf(nodes, 'a', 'b')).toBe(false)
    expect(isDescendantOf(nodes, 'b', 'b')).toBe(false)
    expect(isDescendantOf(nodes, 'root', 'root')).toBe(false)
    expect(isDescendantOf(nodes, 'ghost', 'b')).toBe(false)
  })

  it('subtreeIds 含自己', () => {
    expect(subtreeIds(nodes, 'b')).toEqual(['b', 'b1', 'b2'])
    expect(subtreeIds(nodes, 'b1')).toEqual(['b1'])
  })
})

describe('normalizeNodeOrder', () => {
  it('把每级 order 重排成连续 0..n-1（保持相对顺序）', () => {
    const scrambled = makeNodes([
      makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
      makeNode({ id: 'a', parentId: 'root', order: 5 }),
      makeNode({ id: 'b', parentId: 'root', order: 9 }),
      makeNode({ id: 'c', parentId: 'root', order: 7 }),
    ])
    const ordered = normalizeNodeOrder(scrambled)
    expect(childrenOf(ordered, 'root').map((node) => node.id)).toEqual(['a', 'c', 'b'])
    expect(ordersOf(ordered, 'root')).toEqual([0, 1, 2])
    expect(ordered.a.order).toBe(0)
    expect(ordered.c.order).toBe(1)
    expect(ordered.b.order).toBe(2)
    // 不修改输入
    expect(scrambled.a.order).toBe(5)
  })

  it('order 已经连续时保留原对象引用（避免无意义的重建）', () => {
    const normalized = normalizeNodeOrder(nodes)
    expect(normalized.a).toBe(nodes.a)
    expect(normalized.b1).toBe(nodes.b1)
  })

  it('不同父级各自重排', () => {
    const mixed = makeNodes([
      makeNode({ id: 'p1', parentId: null, order: 3 }),
      makeNode({ id: 'c1', parentId: 'p1', order: 4 }),
      makeNode({ id: 'c2', parentId: 'p1', order: 2 }),
    ])
    const ordered = normalizeNodeOrder(mixed)
    expect(ordered.p1.order).toBe(0)
    expect(ordered.c2.order).toBe(0)
    expect(ordered.c1.order).toBe(1)
  })
})

describe('treeOf / flattenTree', () => {
  it('treeOf(nodes, parentId) 取该父级下的子树森林，children 按 order 升序', () => {
    const forest = treeOf(nodes, 'root')
    expect(forest.map((item) => item.node.id)).toEqual(['b', 'c', 'a'])
    expect(forest[0].children.map((item) => item.node.id)).toEqual(['b1', 'b2'])
    expect(forest[1].children.map((item) => item.node.id)).toEqual(['c1'])
    expect(forest[2].children).toEqual([])
  })

  it('默认取整片森林（parentId 为 null 的节点，也就是根容器）', () => {
    expect(treeOf(nodes).map((item) => item.node.id)).toEqual(['root'])
    expect(treeOf(nodes)[0].children.map((item) => item.node.id)).toEqual(['b', 'c', 'a'])
  })

  it('flattenTree 前序展开且包含根', () => {
    expect(flattenTree(treeOf(nodes)).map((node) => node.id)).toEqual([
      'root',
      'b',
      'b1',
      'b2',
      'c',
      'c1',
      'a',
    ])
    expect(flattenTree(treeOf(nodes, 'root')).map((node) => node.id)).toEqual(['b', 'b1', 'b2', 'c', 'c1', 'a'])
  })

  it('空输入返回空数组', () => {
    expect(treeOf(makeNodes([]), 'root')).toEqual([])
    expect(flattenTree([])).toEqual([])
  })
})
