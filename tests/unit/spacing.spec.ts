import { describe, expect, it } from 'vitest'
import { spacingHints } from '@/core/spacing'
import type { Box, SceneNode } from '@/core/schema/types'

/**
 * M2 等距提示：拖动时给出「到左边/右边邻居多远」的间距，两侧相等就标出来（Figma 那种距离标）。
 * 纯逻辑在 core，画布只负责画线段。
 */

function node(id: string, parentId: string | null, order: number, box: Box, hidden = false): [string, SceneNode] {
  return [
    id,
    {
      id,
      type: 'rect',
      parentId,
      order,
      layout: {
        mode: 'free',
        position: { x: box.x, y: box.y },
        size: { w: { kind: 'fixed', value: box.w }, h: { kind: 'fixed', value: box.h } },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        columns: 1,
        align: 'start',
        justify: 'start',
        wrap: false,
        constraints: { h: 'left', v: 'top' },
      },
      style: {},
      props: {},
      overrides: {},
      meta: { hidden, locked: false },
    } as unknown as SceneNode,
  ]
}

function scene(): { nodes: Record<string, SceneNode>; boxes: Record<string, Box> } {
  const boxes: Record<string, Box> = {
    root: { x: 0, y: 0, w: 1440, h: 900 },
    a: { x: 100, y: 100, w: 50, h: 50 },
    target: { x: 200, y: 100, w: 50, h: 50 },
    b: { x: 300, y: 100, w: 50, h: 50 },
  }
  const nodes = Object.fromEntries([
    node('root', null, 0, boxes.root),
    node('a', 'root', 0, boxes.a),
    node('target', 'root', 1, boxes.target),
    node('b', 'root', 2, boxes.b),
  ])
  return { nodes, boxes }
}

describe('M2 等距提示：拖动节点与同层邻居的间距', () => {
  it('左右两侧间距相等时给出两条提示并标记 equal', () => {
    const { nodes, boxes } = scene()
    const hints = spacingHints({ nodes, boxes, rootId: 'root', ids: ['target'] })

    expect(hints).toHaveLength(2)
    expect(hints[0]).toMatchObject({ axis: 'x', gap: 50, equal: true, from: 150, to: 200 })
    expect(hints[1]).toMatchObject({ axis: 'x', gap: 50, equal: true, from: 250, to: 300 })
    // 距离标画在两盒垂直重叠区的中间
    expect(hints[0].cross).toBe(125)
    expect(hints[0].crossSize).toBe(50)
  })

  it('两侧间距不等时仍给出提示但 equal 为 false', () => {
    const { nodes, boxes } = scene()
    boxes.b = { x: 260, y: 100, w: 50, h: 50 }
    const hints = spacingHints({ nodes, boxes, rootId: 'root', ids: ['target'] })

    expect(hints).toHaveLength(2)
    expect(hints[0]).toMatchObject({ gap: 50, equal: false })
    expect(hints[1]).toMatchObject({ gap: 10, equal: false })
  })

  it('隐藏的邻居与被拖动的同层节点都不参与', () => {
    const { nodes, boxes } = scene()
    nodes.b.meta = { hidden: true, locked: false }
    expect(spacingHints({ nodes, boxes, rootId: 'root', ids: ['target'] }).map((hint) => hint.gap)).toEqual([50])

    // 同时拖 target 与 b 时，两者都不是对方的邻居
    expect(
      spacingHints({ nodes, boxes, rootId: 'root', ids: ['target', 'b'] }).map((hint) => hint.gap),
    ).toEqual([50])
  })

  it('上下方向单独计算，没有邻居时返回空数组', () => {
    const { nodes, boxes } = scene()
    boxes.a = { x: 200, y: 20, w: 50, h: 50 }
    boxes.b = { x: 200, y: 300, w: 50, h: 50 }
    const hints = spacingHints({ nodes, boxes, rootId: 'root', ids: ['target'] })

    // a 在正上方（x 完全重叠）、b 在正下方 → 只有 y 方向
    expect(hints.every((hint) => hint.axis === 'y')).toBe(true)
    expect(hints.map((hint) => hint.gap)).toEqual([30, 150])

    boxes.a = { x: 1000, y: 20, w: 50, h: 50 }
    boxes.b = { x: 1000, y: 300, w: 50, h: 50 }
    expect(spacingHints({ nodes, boxes, rootId: 'root', ids: ['target'] })).toEqual([])
  })
})
