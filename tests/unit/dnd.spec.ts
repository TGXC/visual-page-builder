import { describe, expect, it } from 'vitest'
import type { Box, NodeId, SceneNode } from '@/core/schema/types'
import { dropParentAt, localPosition, reparentPatches } from '@/core/dnd'
import { makeNode, makeNodes, makePage } from './factories'

/**
 * M2：拖拽换父级。
 *
 * 落点判定必须基于**布局引擎算出来的盒**（`boxes`），而不是节点自己的 `layout.position`——
 * `vertical / grid` 里子节点的位置根本不由它自己决定，用文档字段判定会指到空处。
 */

function scene(): { nodes: Record<NodeId, SceneNode>; boxes: Record<NodeId, Box>; rootId: NodeId } {
  const nodes = makeNodes([
    makeNode({ id: 'root', type: 'frame', layout: { ...makeNode({ id: 'x' }).layout, size: { w: { kind: 'fixed', value: 1440 }, h: { kind: 'fixed', value: 900 } } } }),
    makeNode({ id: 'section', type: 'frame', parentId: 'root', order: 0 }),
    makeNode({ id: 'card', type: 'frame', parentId: 'section', order: 0 }),
    makeNode({ id: 'label', type: 'rect', parentId: 'card', order: 0 }),
    makeNode({ id: 'badge', type: 'rect', parentId: 'card', order: 1 }),
  ])
  const boxes: Record<NodeId, Box> = {
    root: { x: 0, y: 0, w: 1440, h: 900 },
    section: { x: 100, y: 100, w: 400, h: 300 },
    card: { x: 150, y: 150, w: 200, h: 100 },
    label: { x: 200, y: 200, w: 60, h: 40 },
    badge: { x: 270, y: 200, w: 60, h: 40 },
  }
  return { nodes, boxes, rootId: 'root' }
}

describe('M2 拖拽换父级：落点判定', () => {
  it('取指针下最深的容器；点到画布外返回 null', () => {
    const { nodes, boxes, rootId } = scene()
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 160, y: 160 } })).toBe('card')
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 110, y: 110 } })).toBe('section')
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 10, y: 10 } })).toBe('root')
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: -20, y: 10 } })).toBeNull()
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 10, y: 5000 } })).toBeNull()
  })

  it('非容器节点（比如 rect 文字块）不能当落点，返回它上面的容器', () => {
    const { nodes, boxes, rootId } = scene()
    // label 是 rect，(200,200)-(260,240) 落在它身上
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 210, y: 210 } })).toBe('card')
  })

  it('被拖动的节点及其子孙都不能当落点', () => {
    const { nodes, boxes, rootId } = scene()
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 160, y: 160 }, exclude: ['section'] })).toBe('root')
    // 拖 label 时，card 仍然可以当落点
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 210, y: 210 }, exclude: ['label'] })).toBe('card')
  })

  it('隐藏的容器不算落点', () => {
    const { nodes, boxes, rootId } = scene()
    nodes.card = { ...nodes.card, meta: { ...nodes.card.meta, hidden: true } }
    expect(dropParentAt({ nodes, boxes, rootId, point: { x: 160, y: 160 } })).toBe('section')
  })

  it('localPosition 把屏幕盒换算成当前父容器内容框坐标（含 padding）', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    nodes.card.layout = { ...nodes.card.layout, padding: { top: 10, right: 10, bottom: 10, left: 20 } }
    // card 在 (150,150)，padding 左 20 / 上 10 → 内容原点 (170,160)
    expect(localPosition(page, boxes, 'label')).toEqual({ x: 30, y: 40 })
    // 根的直接子节点：原点就是根盒原点
    expect(localPosition(page, boxes, 'section')).toEqual({ x: 100, y: 100 })
    expect(localPosition(page, boxes, 'missing')).toBeNull()
  })
})

describe('M2 拖拽换父级：补丁', () => {
  it('换父级时把位置换算到新容器的内容框，并追加到末尾', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    // root 无 padding，(0,0) 原点；section 在 (100,100) 且 padding 10 → 内容原点 (110,110)
    const section = nodes.section
    section.layout = { ...section.layout, padding: { top: 10, right: 10, bottom: 10, left: 10 } }
    boxes.label = { x: 200, y: 200, w: 60, h: 40 }

    const patches = reparentPatches(page, boxes, ['label'], 'section')
    expect(patches).toHaveLength(2)

    const [move, update] = patches
    expect(move.op).toBe('move')
    if (move.op !== 'move') throw new Error('第一个补丁应该是 move')
    expect(move.before).toEqual({ parentId: 'card', order: 0 })
    expect(move.after).toEqual({ parentId: 'section', order: 1 })

    expect(update.op).toBe('update')
    if (update.op !== 'update') throw new Error('第二个补丁应该是 update')
    expect(update.after.layout?.position).toEqual({ x: 90, y: 90 })
    expect(update.before.layout?.position).toEqual({ x: 0, y: 0 })
  })

  it('拒绝把节点移进自己的子孙（会成环）', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    expect(reparentPatches(page, boxes, ['section'], 'card')).toEqual([])
    expect(reparentPatches(page, boxes, ['section'], 'section')).toEqual([])
  })

  it('已经是该父级的子节点就跳过（不产生空补丁）', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    expect(reparentPatches(page, boxes, ['card'], 'section')).toEqual([])
  })

  it('多个节点连续追加 order', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    const patches = reparentPatches(page, boxes, ['label', 'badge'], 'root')
    const moves = patches.filter((patch) => patch.op === 'move')
    expect(moves.map((patch) => (patch.op === 'move' ? [patch.id, patch.after.order] : null))).toEqual([
      ['label', 1],
      ['badge', 2],
    ])
  })

  it('拖动集合里同时有父子时只移动最外层（子树跟着走）', () => {
    const { nodes, boxes } = scene()
    const page = makePage({ id: 'page_1', root: 'root', nodes })
    // label 在 card 里面：拖 card 时 label 跟着走，不该为它单独出补丁
    const patches = reparentPatches(page, boxes, ['label', 'card'], 'root')
    const moves = patches.filter((patch) => patch.op === 'move')
    expect(moves.map((patch) => (patch.op === 'move' ? [patch.id, patch.after] : null))).toEqual([
      ['card', { parentId: 'root', order: 1 }],
    ])
  })
})
