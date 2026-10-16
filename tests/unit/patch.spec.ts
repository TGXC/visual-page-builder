import { describe, expect, it } from 'vitest'
import type { Doc, MoveTarget, NodePatchData, Patch, SceneNode } from '@/core/schema/types'
import { applyPatch, applyPatches, invertPatch, invertPatches } from '@/core/patch'
import { childrenOf } from '@/core/tree'
import { docWithNodes, makeNode, ordersOf, snapshot } from './factories'

const PAGE = 'page_1'

/** root(a, b, c, box(d, e)) —— 既有同级重排，也有跨容器移动 */
function tree(): Doc {
  return docWithNodes([
    makeNode({ id: 'root', type: 'frame' }),
    makeNode({ id: 'a', parentId: 'root', order: 0 }),
    makeNode({ id: 'b', parentId: 'root', order: 1, type: 'text', props: { text: 'B' } }),
    makeNode({ id: 'c', parentId: 'root', order: 2 }),
    makeNode({ id: 'box', parentId: 'root', order: 3, type: 'frame' }),
    makeNode({ id: 'd', parentId: 'box', order: 0 }),
    makeNode({ id: 'e', parentId: 'box', order: 1 }),
  ])
}

function ids(doc: Doc, parentId: string | null): string[] {
  return childrenOf(doc.pages[0].nodes, parentId).map((node) => node.id)
}

function node(doc: Doc, id: string): SceneNode | undefined {
  return doc.pages[0].nodes[id]
}

/** 每个父级下的 order 都必须是 0..n-1 连续 */
function expectOrdersContiguous(doc: Doc) {
  const nodes = doc.pages[0].nodes
  const parents = new Set(Object.values(nodes).map((n) => n.parentId))
  for (const parentId of parents) {
    const orders = ordersOf(nodes, parentId)
    expect(orders).toEqual(orders.map((_, index) => index))
  }
}

function insert(node: SceneNode): Patch {
  return { op: 'insert', pageId: PAGE, node }
}

function remove(node: SceneNode): Patch {
  return { op: 'remove', pageId: PAGE, node }
}

function update(id: string, before: NodePatchData, after: NodePatchData): Patch {
  return { op: 'update', pageId: PAGE, id, before, after }
}

function move(id: string, before: MoveTarget, after: MoveTarget): Patch {
  return { op: 'move', pageId: PAGE, id, before, after }
}

describe('applyPatch：insert', () => {
  it('插到末尾：追加节点，order 连续，且不改动输入文档', () => {
    const doc = tree()
    const before = snapshot(doc)
    const x = makeNode({ id: 'x', parentId: 'root', order: 4 })

    const next = applyPatch(doc, insert(x))

    expect(ids(next, 'root')).toEqual(['a', 'b', 'c', 'box', 'x'])
    expect(ordersOf(next.pages[0].nodes, 'root')).toEqual([0, 1, 2, 3, 4])
    expectOrdersContiguous(next)
    expect(snapshot(doc)).toBe(before)
  })

  it('插到中间：后面的同级节点整体后移一位', () => {
    const x = makeNode({ id: 'x', parentId: 'root', order: 1 })

    const next = applyPatch(tree(), insert(x))

    expect(ids(next, 'root')).toEqual(['a', 'x', 'b', 'c', 'box'])
    expect(ordersOf(next.pages[0].nodes, 'root')).toEqual([0, 1, 2, 3, 4])
    expectOrdersContiguous(next)
  })

  it('插进空容器：order 归零', () => {
    const empty = docWithNodes([makeNode({ id: 'root', type: 'frame' })])
    const x = makeNode({ id: 'x', parentId: 'root', order: 3 })

    const next = applyPatch(empty, insert(x))

    expect(ids(next, 'root')).toEqual(['x'])
    expect(node(next, 'x')?.order).toBe(0)
  })
})

describe('applyPatch：remove', () => {
  it('删中间的节点：后面的同级节点整体前移一位', () => {
    const doc = tree()
    const target = node(doc, 'b')!

    const next = applyPatch(doc, remove(target))

    expect(node(next, 'b')).toBeUndefined()
    expect(ids(next, 'root')).toEqual(['a', 'c', 'box'])
    expect(ordersOf(next.pages[0].nodes, 'root')).toEqual([0, 1, 2])
    expectOrdersContiguous(next)
  })

  it('删掉后再求逆应用，逐字节回到原文档', () => {
    const doc = tree()
    const patch = remove(node(doc, 'b')!)

    const undone = applyPatches(applyPatch(doc, patch), invertPatches([patch]))

    expect(snapshot(undone)).toBe(snapshot(doc))
  })
})

describe('applyPatch：update', () => {
  it('只改 after 里列出的字段，其余保持不变', () => {
    const doc = tree()
    const next = applyPatch(
      doc,
      update('a', { meta: node(doc, 'a')!.meta }, { meta: { name: '主视觉', hidden: false, locked: false } }),
    )

    expect(node(next, 'a')?.meta.name).toBe('主视觉')
    expect(node(next, 'a')?.type).toBe('rect')
    expect(node(next, 'a')?.order).toBe(0)
  })

  it('props 是整体替换而不是合并', () => {
    const doc = tree()
    const next = applyPatch(doc, update('b', { props: { text: 'B' } }, { props: { text: 'B2' } }))

    expect(node(next, 'b')?.props).toEqual({ text: 'B2' })
  })

  it('可以改类型', () => {
    const next = applyPatch(tree(), update('a', { type: 'rect' }, { type: 'circle' }))
    expect(node(next, 'a')?.type).toBe('circle')
  })

  it('求逆后逐字节回到原文档', () => {
    const doc = tree()
    const patch = update(
      'b',
      { props: { text: 'B' }, style: node(doc, 'b')!.style },
      {
        props: { text: '新文案', sub: '副标题' },
        style: { ...node(doc, 'b')!.style, fontSize: 18, color: '#111' },
      },
    )

    const undone = applyPatches(applyPatch(doc, patch), invertPatches([patch]))

    expect(snapshot(undone)).toBe(snapshot(doc))
  })
})

describe('applyPatch：move', () => {
  it('同级重排：把第一个挪到最后', () => {
    const next = applyPatch(tree(), move('a', { parentId: 'root', order: 0 }, { parentId: 'root', order: 3 }))

    expect(ids(next, 'root')).toEqual(['b', 'c', 'box', 'a'])
    expect(ordersOf(next.pages[0].nodes, 'root')).toEqual([0, 1, 2, 3])
    expectOrdersContiguous(next)
  })

  it('跨容器移动：新旧父级的 order 都重新连续', () => {
    const next = applyPatch(tree(), move('c', { parentId: 'root', order: 2 }, { parentId: 'box', order: 1 }))

    expect(ids(next, 'root')).toEqual(['a', 'b', 'box'])
    expect(ids(next, 'box')).toEqual(['d', 'c', 'e'])
    expectOrdersContiguous(next)
  })

  it('移动求逆后逐字节回到原文档（同级与跨容器都一样）', () => {
    const sameLevel = move('a', { parentId: 'root', order: 0 }, { parentId: 'root', order: 3 })
    const crossLevel = move('c', { parentId: 'root', order: 2 }, { parentId: 'box', order: 1 })

    for (const patch of [sameLevel, crossLevel]) {
      const doc = tree()
      const undone = applyPatches(applyPatch(doc, patch), invertPatches([patch]))
      expect(snapshot(undone)).toBe(snapshot(doc))
    }
  })
})

describe('applyPatch：脏输入', () => {
  it('pageId 对不上时原样返回', () => {
    const doc = tree()
    const bad: Patch = { op: 'insert', pageId: 'page_404', node: makeNode({ id: 'x' }) }
    expect(snapshot(applyPatch(doc, bad))).toBe(snapshot(doc))
  })

  it('操作不存在的节点时原样返回', () => {
    const doc = tree()
    expect(snapshot(applyPatch(doc, update('ghost', {}, { type: 'circle' })))).toBe(snapshot(doc))
    expect(
      snapshot(applyPatch(doc, move('ghost', { parentId: null, order: 0 }, { parentId: 'root', order: 0 }))),
    ).toBe(snapshot(doc))
    expect(snapshot(applyPatch(doc, remove(makeNode({ id: 'ghost' }))))).toBe(snapshot(doc))
  })

  it('invertPatch 是自包含的：insert 与 remove 互换，update/move 交换 before/after', () => {
    const x = makeNode({ id: 'x' })
    expect(invertPatch(insert(x))).toEqual({ op: 'remove', pageId: PAGE, node: x })
    expect(invertPatch(remove(x))).toEqual({ op: 'insert', pageId: PAGE, node: x })
    const up = update('a', { type: 'rect' }, { type: 'circle' })
    expect(invertPatch(up)).toEqual(update('a', { type: 'circle' }, { type: 'rect' }))
    const mv = move('a', { parentId: 'root', order: 0 }, { parentId: 'box', order: 1 })
    expect(invertPatch(mv)).toEqual(move('a', { parentId: 'box', order: 1 }, { parentId: 'root', order: 0 }))
  })
})

/** 固定种子的伪随机（测试可复现） */
function mulberry32(seed: number): () => number {
  let t = seed
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

describe('applyPatch：随机补丁链的性质', () => {
  it('60 个随机补丁逐个应用后，按逆序求逆必须逐字节回到起点', () => {
    const random = mulberry32(20261016)
    const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]

    let doc = tree()
    const start = snapshot(doc)
    const applied: Patch[] = []
    let counter = 0

    for (let step = 0; step < 60; step += 1) {
      const nodes = doc.pages[0].nodes
      const all = Object.values(nodes)
      const roll = random()

      let patch: Patch
      if (roll < 0.3) {
        const siblings = childrenOf(nodes, 'root')
        patch = insert(
          makeNode({
            id: `n${counter++}`,
            parentId: 'root',
            order: Math.floor(random() * (siblings.length + 1)),
          }),
        )
      } else if (roll < 0.5) {
        const removable = all.filter((n) => n.id !== 'root' && childrenOf(nodes, n.id).length === 0)
        patch = remove(pick(removable))
      } else if (roll < 0.75) {
        const target = pick(all)
        patch = update(target.id, { props: target.props }, { props: { ...target.props, text: `t${counter++}` } })
      } else {
        const target = pick(all.filter((n) => n.id !== 'root'))
        const targetParent = pick(['root', 'box'])
        if (targetParent === target.id) continue
        const count = childrenOf(nodes, targetParent).filter((n) => n.id !== target.id).length
        patch = move(
          target.id,
          { parentId: target.parentId, order: target.order },
          { parentId: targetParent, order: Math.floor(random() * (count + 1)) },
        )
      }

      doc = applyPatch(doc, patch)
      applied.push(patch)
      expectOrdersContiguous(doc)
    }

    for (const patch of invertPatches(applied)) {
      doc = applyPatch(doc, patch)
    }

    expect(snapshot(doc)).toBe(start)
  })
})
