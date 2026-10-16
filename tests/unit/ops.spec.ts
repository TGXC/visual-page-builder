import { describe, expect, it } from 'vitest'
import { applyPatches, invertPatches } from '@/core/patch'
import type { Doc, SceneNode } from '@/core/schema/types'
import { createNode, alignPatches, duplicatePatches, removePatches, reorderLayerPatch } from '@/core/ops'
import { childrenOf } from '@/core/tree'
import { docWithNodes, makeNode, ordersOf } from './factories'

function base(): Doc {
  return docWithNodes([
    makeNode({ id: 'root', type: 'frame' }),
    makeNode({ id: 'a', parentId: 'root', order: 0 }),
    makeNode({ id: 'b', parentId: 'root', order: 1 }),
    makeNode({ id: 'box', parentId: 'root', order: 2, type: 'group' }),
    makeNode({ id: 'inner', parentId: 'box', order: 0 }),
  ])
}

function withPosition(node: SceneNode, x: number, y: number, w = 100, h = 50): SceneNode {
  return {
    ...node,
    layout: {
      ...node.layout,
      position: { x, y },
      size: { w: { kind: 'fixed', value: w }, h: { kind: 'fixed', value: h } },
    },
  }
}

describe('ops：createNode', () => {
  it('按类型给出默认尺寸、样式与属性', () => {
    const button = createNode('button', { parentId: 'root', order: 3 })
    expect(button.type).toBe('button')
    expect(button.parentId).toBe('root')
    expect(button.order).toBe(3)
    expect(button.layout.size.w.value).toBeGreaterThan(0)
    expect(button.props.text).toBeTruthy()
    expect(button.meta.hidden).toBe(false)
    expect(button.id.startsWith('n_')).toBe(true)
  })

  it('可以覆盖位置、尺寸、属性与图层名', () => {
    const node = createNode('text', {
      parentId: null,
      order: 0,
      position: { x: 12, y: 34 },
      size: { w: 200, h: 40 },
      props: { text: '自定义' },
      label: '标题',
    })
    expect(node.layout.position).toEqual({ x: 12, y: 34 })
    expect(node.layout.size.w.value).toBe(200)
    expect(node.props.text).toBe('自定义')
    expect(node.meta.name).toBe('标题')
  })
})

describe('ops：删除', () => {
  it('删除容器会连同子孙一起删，且先删深的（撤销顺序才对）', () => {
    const doc = base()
    const patches = removePatches(doc.pages[0], ['box'])
    expect(patches.map((patch) => (patch.op === 'remove' ? patch.node.id : ''))).toEqual(['inner', 'box'])

    const next = applyPatches(doc, patches)
    expect(Object.keys(next.pages[0].nodes).sort()).toEqual(['a', 'b', 'root'])
  })

  it('删除后同级 order 连续，且能逐字节撤销回原状', () => {
    const doc = base()
    const before = JSON.stringify(doc)
    const patches = removePatches(doc.pages[0], ['b'])
    const removed = applyPatches(doc, patches)
    expect(childrenOf(removed.pages[0].nodes, 'root').map((n) => n.id)).toEqual(['a', 'box'])
    expect(ordersOf(removed.pages[0].nodes, 'root')).toEqual([0, 1])

    const restored = applyPatches(removed, invertPatches(patches))
    expect(JSON.stringify(restored)).toBe(before)
  })

  it('忽略不存在的 id', () => {
    const doc = base()
    expect(removePatches(doc.pages[0], ['ghost'])).toEqual([])
  })
})

describe('ops：复制', () => {
  it('复制容器时子孙一起复制，并且新 id 全不相同', () => {
    const doc = base()
    const { patches, newIds } = duplicatePatches(doc.pages[0], ['box'])
    const next = applyPatches(doc, patches)
    const nodes = next.pages[0].nodes

    expect(newIds).toHaveLength(1)
    const cloneId = newIds[0]
    expect(cloneId).not.toBe('box')
    expect(nodes[cloneId].parentId).toBe('root')
    const children = childrenOf(nodes, cloneId)
    expect(children).toHaveLength(1)
    expect(children[0].id).not.toBe('inner')
    expect(children[0].type).toBe(nodes.inner.type)
    expect(children[0].parentId).toBe(cloneId)
  })

  it('副本整体偏移，且原节点不受影响', () => {
    const doc = docWithNodes([
      makeNode({ id: 'root', type: 'frame' }),
      withPosition(makeNode({ id: 'a', parentId: 'root', order: 0 }), 100, 100),
    ])
    const { patches, newIds } = duplicatePatches(doc.pages[0], ['a'], 16)
    const next = applyPatches(doc, patches)
    expect(next.pages[0].nodes[newIds[0]].layout.position).toEqual({ x: 116, y: 116 })
    expect(next.pages[0].nodes.a.layout.position).toEqual({ x: 100, y: 100 })
  })
})

describe('ops：对齐', () => {
  function spread(): Doc {
    return docWithNodes([
      makeNode({ id: 'root', type: 'frame' }),
      withPosition(makeNode({ id: 'a', parentId: 'root', order: 0 }), 0, 0, 100, 50),
      withPosition(makeNode({ id: 'b', parentId: 'root', order: 1 }), 300, 200, 200, 100),
    ])
  }

  it('少于两个节点时不动', () => {
    const doc = spread()
    expect(alignPatches(doc.pages[0], ['a'], 'left')).toEqual([])
  })

  it('左对齐 / 上对齐到选区包围盒', () => {
    const doc = spread()
    const left = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'left'))
    expect(left.pages[0].nodes.a.layout.position.x).toBe(0)
    expect(left.pages[0].nodes.b.layout.position.x).toBe(0)

    const top = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'top'))
    expect(top.pages[0].nodes.b.layout.position.y).toBe(0)
  })

  it('水平居中 / 右对齐 / 垂直居中 / 底对齐', () => {
    const doc = spread()
    const center = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'hcenter'))
    expect(center.pages[0].nodes.a.layout.position.x).toBe(200)
    const right = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'right'))
    expect(right.pages[0].nodes.a.layout.position.x).toBe(400)
    const vcenter = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'vcenter'))
    expect(vcenter.pages[0].nodes.a.layout.position.y).toBe(125)
    const bottom = applyPatches(doc, alignPatches(doc.pages[0], ['a', 'b'], 'bottom'))
    expect(bottom.pages[0].nodes.a.layout.position.y).toBe(250)
  })

  it('父子同时被选中时不再对子节点重复对齐', () => {
    const doc = docWithNodes([
      makeNode({ id: 'root', type: 'frame' }),
      withPosition(makeNode({ id: 'box', parentId: 'root', order: 0, type: 'group' }), 0, 0, 100, 100),
      withPosition(makeNode({ id: 'inner', parentId: 'box', order: 0 }), 0, 0, 20, 20),
      withPosition(makeNode({ id: 'b', parentId: 'root', order: 1 }), 300, 0, 100, 100),
    ])
    const patches = alignPatches(doc.pages[0], ['box', 'inner', 'b'], 'left')
    expect(patches).toHaveLength(1)
    expect(patches[0].op === 'update' ? patches[0].id : '').toBe('b')
  })
})

describe('ops：层级', () => {
  it('上移/下移/置顶/置底改变同级 order，越界返回 null', () => {
    const doc = base()
    const up = reorderLayerPatch(doc.pages[0], 'a', 'up')
    expect(up && up.op === 'move' ? up.after.order : -1).toBe(1)
    expect(reorderLayerPatch(doc.pages[0], 'a', 'down')).toBeNull()
    const front = reorderLayerPatch(doc.pages[0], 'a', 'front')
    expect(front && front.op === 'move' ? front.after.order : -1).toBe(2)
    const back = reorderLayerPatch(doc.pages[0], 'box', 'back')
    expect(back && back.op === 'move' ? back.after.order : -1).toBe(0)
    expect(reorderLayerPatch(doc.pages[0], 'box', 'front')).toBeNull()
    expect(reorderLayerPatch(doc.pages[0], 'ghost', 'up')).toBeNull()
  })

  it('上移后同级顺序真的变了', () => {
    const doc = base()
    const patch = reorderLayerPatch(doc.pages[0], 'a', 'up')
    const next = applyPatches(doc, patch ? [patch] : [])
    expect(childrenOf(next.pages[0].nodes, 'root').map((n) => n.id)).toEqual(['b', 'a', 'box'])
  })
})
