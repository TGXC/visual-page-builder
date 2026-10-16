import { describe, expect, it } from 'vitest'
import type { Box, SceneNode } from '@/core/schema/types'
import { computeLayout, estimateTextSize } from '@/core/layout'
import { makeNode, makeNodes } from './factories'

const BASE = makeNode({ id: '__base' }).layout

function frame(id: string, layout: Partial<SceneNode['layout']> = {}, extra: Partial<SceneNode> = {}): SceneNode {
  return makeNode({ ...extra, id, type: 'frame', layout: { ...BASE, ...layout } })
}

function child(
  id: string,
  parentId: string,
  order: number,
  layout: Partial<SceneNode['layout']> = {},
  extra: Partial<SceneNode> = {},
): SceneNode {
  return makeNode({ ...extra, id, parentId, order, layout: { ...BASE, ...layout } })
}

function box(boxes: Record<string, Box>, id: string): Box {
  const value = boxes[id]
  if (!value) throw new Error(`布局结果里没有 ${id}`)
  return value
}

function fixed(value: number): SceneNode['layout']['size']['w'] {
  return { kind: 'fixed', value }
}

describe('M2 布局引擎：free 模式', () => {
  const nodes = makeNodes([
    frame('root', { size: { w: fixed(800), h: fixed(600) } }),
    child('a', 'root', 0, { position: { x: 40, y: 60 }, size: { w: fixed(200), h: fixed(80) } }),
  ])

  it('根 box 取 viewport，子元素按 position 绝对定位', () => {
    const result = computeLayout({ nodes, rootId: 'root', viewport: { w: 800, h: 600 } })
    expect(box(result.boxes, 'root')).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(box(result.boxes, 'a')).toEqual({ x: 40, y: 60, w: 200, h: 80 })
  })

  it('缺省 viewport 时用根节点自己的 fixed 尺寸', () => {
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(box(result.boxes, 'root')).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })

  it('子元素坐标相对父容器的内容框（padding 内）', () => {
    const padded = makeNodes([
      frame('root', { padding: { top: 20, right: 0, bottom: 0, left: 30 }, size: { w: fixed(800), h: fixed(600) } }),
      child('a', 'root', 0, { position: { x: 10, y: 5 } }),
    ])
    expect(box(computeLayout({ nodes: padded, rootId: 'root' }).boxes, 'a')).toMatchObject({ x: 40, y: 25 })
  })

  it('fill 撑满父内容区，hug 包住子节点并集，ratio 由另一边反推', () => {
    const mixed = makeNodes([
      frame('root', { size: { w: fixed(400), h: fixed(300) } }),
      child('fill', 'root', 0, { size: { w: { kind: 'fill' }, h: { kind: 'fill' } } }),
      child('ratio', 'root', 1, { size: { w: fixed(300), h: { kind: 'ratio', value: 3 } } }),
      child('hug', 'root', 2, { size: { w: { kind: 'hug' }, h: { kind: 'hug' } } }),
      child('inner', 'hug', 0, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(20) } }),
    ])
    const result = computeLayout({ nodes: mixed, rootId: 'root' })
    expect(box(result.boxes, 'fill')).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    // w/h = 3 → h = 300 / 3 = 100
    expect(box(result.boxes, 'ratio')).toMatchObject({ w: 300, h: 100 })
    // hug 容器 = 子节点并集（10+50, 10+20），即包到最远的右下角
    expect(box(result.boxes, 'hug')).toMatchObject({ x: 0, y: 0, w: 60, h: 30 })
  })

  it('hug 文本在无测量函数时按字符估算并标记 estimated，有测量函数时用测量值', () => {
    const nodes2 = makeNodes([
      frame('root', { size: { w: fixed(400), h: fixed(300) } }),
      child(
        't',
        'root',
        0,
        { size: { w: { kind: 'hug' }, h: { kind: 'hug' } } },
        { type: 'text', style: { ...makeNode({ id: 'x' }).style, fontSize: 16 }, props: { text: '可视化页面搭建器' } },
      ),
    ])
    const estimated = computeLayout({ nodes: nodes2, rootId: 'root' })
    expect(estimated.estimated).toContain('t')
    expect(box(estimated.boxes, 't').w).toBeGreaterThan(0)
    expect(box(estimated.boxes, 't').h).toBeGreaterThan(0)

    const measured = computeLayout({ nodes: nodes2, rootId: 'root', measure: () => ({ w: 321, h: 45 }) })
    expect(measured.estimated).toEqual([])
    expect(box(measured.boxes, 't')).toMatchObject({ w: 321, h: 45 })
  })

  it('测量函数返回 undefined（jsdom / 没有 Canvas）时退回估算，不能把 undefined 当尺寸', () => {
    const nodes2 = makeNodes([
      frame('root', { size: { w: fixed(400), h: fixed(300) } }),
      child(
        't',
        'root',
        0,
        { size: { w: { kind: 'hug' }, h: { kind: 'hug' } } },
        { type: 'text', style: { ...makeNode({ id: 'x' }).style, fontSize: 16 }, props: { text: '可视化页面搭建器' } },
      ),
    ])
    const result = computeLayout({ nodes: nodes2, rootId: 'root', measure: () => undefined })
    expect(result.estimated).toContain('t')
    expect(box(result.boxes, 't').w).toBeGreaterThan(0)
    expect(box(result.boxes, 't').h).toBeGreaterThan(0)
  })

  it('estimateTextSize 随文本长度增长，空文本不炸', () => {
    const style = { ...makeNode({ id: 'x' }).style, fontSize: 16 }
    const small = estimateTextSize(makeNode({ id: 'a', type: 'text', style, props: { text: '短' } }))
    const big = estimateTextSize(makeNode({ id: 'b', type: 'text', style, props: { text: '很长很长很长很长很长很长很长很长' } }))
    expect(big.w).toBeGreaterThan(small.w)
    expect(estimateTextSize(makeNode({ id: 'c', type: 'text', style, props: {} })).w).toBeGreaterThanOrEqual(0)
  })

  it('结果确定：同一输入两次深度相等', () => {
    const first = computeLayout({ nodes, rootId: 'root', viewport: { w: 800, h: 600 } })
    const second = computeLayout({ nodes, rootId: 'root', viewport: { w: 800, h: 600 } })
    expect(first.boxes).toEqual(second.boxes)
  })
})

describe('M2 布局引擎：vertical / horizontal', () => {
  function stack(mode: 'vertical' | 'horizontal', layout: Partial<SceneNode['layout']> = {}) {
    return makeNodes([
      frame('root', { mode, gap: 10, size: { w: fixed(400), h: fixed(300) }, ...layout }),
      child('a', 'root', 0, { size: { w: fixed(50), h: fixed(50) } }),
      child('b', 'root', 1, { size: { w: fixed(70), h: fixed(70) } }),
    ])
  }

  it('vertical 依次堆叠并加 gap', () => {
    const result = computeLayout({ nodes: stack('vertical'), rootId: 'root' })
    expect(box(result.boxes, 'a')).toMatchObject({ y: 0 })
    expect(box(result.boxes, 'b')).toMatchObject({ y: 60 })
  })

  it('horizontal 依次并排并加 gap', () => {
    const result = computeLayout({ nodes: stack('horizontal'), rootId: 'root' })
    expect(box(result.boxes, 'a')).toMatchObject({ x: 0 })
    expect(box(result.boxes, 'b')).toMatchObject({ x: 60 })
  })

  it('align 控制交叉轴：center / end / stretch', () => {
    // 交叉轴是宽度：容器内容宽 400，a 宽 50
    expect(box(computeLayout({ nodes: stack('vertical', { align: 'center' }), rootId: 'root' }).boxes, 'a')).toMatchObject({ x: 175 })
    expect(box(computeLayout({ nodes: stack('vertical', { align: 'end' }), rootId: 'root' }).boxes, 'a')).toMatchObject({ x: 350 })
    expect(box(computeLayout({ nodes: stack('vertical', { align: 'stretch' }), rootId: 'root' }).boxes, 'a')).toMatchObject({ x: 0, w: 400 })
  })

  it('主轴上的 fill 分掉剩余空间，交叉轴上的 fill 撑满', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'vertical', size: { w: fixed(400), h: fixed(300) } }),
      child('a', 'root', 0, { size: { w: fixed(50), h: fixed(100) } }),
      child('grow', 'root', 1, { size: { w: { kind: 'fill' }, h: { kind: 'fill' } } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    // 剩余主尺寸 = 300 - 100 = 200
    expect(box(result.boxes, 'grow')).toMatchObject({ x: 0, y: 100, w: 400, h: 200 })
  })

  it('justify 在父容器有富余时生效：center / end / space-between', () => {
    function withJustify(justify: SceneNode['layout']['justify']) {
      return makeNodes([
        frame('root', { mode: 'vertical', gap: 10, justify, size: { w: fixed(400), h: fixed(300) } }),
        child('a', 'root', 0, { size: { w: fixed(50), h: fixed(50) } }),
        child('b', 'root', 1, { size: { w: fixed(50), h: fixed(50) } }),
      ])
    }
    // 内容 110，富余 190
    expect(box(computeLayout({ nodes: withJustify('start'), rootId: 'root' }).boxes, 'a')).toMatchObject({ y: 0 })
    expect(box(computeLayout({ nodes: withJustify('center'), rootId: 'root' }).boxes, 'a')).toMatchObject({ y: 95 })
    expect(box(computeLayout({ nodes: withJustify('end'), rootId: 'root' }).boxes, 'a')).toMatchObject({ y: 190 })
    const between = computeLayout({ nodes: withJustify('space-between'), rootId: 'root' })
    expect(box(between.boxes, 'a')).toMatchObject({ y: 0 })
    // 两端贴边：b 的 y = 300 - 50
    expect(box(between.boxes, 'b')).toMatchObject({ y: 250 })
  })
})

describe('M2 布局引擎：horizontal wrap 与 grid', () => {
  it('horizontal + wrap 折行，换行后 y 下移到上一行最高元素之下', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'horizontal', wrap: true, gap: 10, size: { w: fixed(250), h: fixed(400) } }),
      child('a', 'root', 0, { size: { w: fixed(100), h: fixed(100) } }),
      child('b', 'root', 1, { size: { w: fixed(100), h: fixed(40) } }),
      child('c', 'root', 2, { size: { w: fixed(100), h: fixed(100) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(box(result.boxes, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(box(result.boxes, 'b')).toMatchObject({ x: 110, y: 0 })
    // 110 + 100 + 10 > 250 → 折行；上一行最高是 a 的 100
    expect(box(result.boxes, 'c')).toMatchObject({ x: 0, y: 110 })
  })

  it('grid 等分列宽，行高取该行最高元素', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'grid', columns: 3, gap: 20, size: { w: fixed(340), h: fixed(400) } }),
      child('a', 'root', 0, { size: { w: { kind: 'fill' }, h: fixed(60) } }),
      child('b', 'root', 1, { size: { w: { kind: 'fill' }, h: fixed(90) } }),
      child('c', 'root', 2, { size: { w: { kind: 'fill' }, h: fixed(30) } }),
      child('d', 'root', 3, { size: { w: { kind: 'fill' }, h: fixed(50) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    // 单元格宽 = (340 - 20*2) / 3 = 100
    expect(box(result.boxes, 'a')).toMatchObject({ x: 0, y: 0, w: 100 })
    expect(box(result.boxes, 'b')).toMatchObject({ x: 120, y: 0 })
    expect(box(result.boxes, 'c')).toMatchObject({ x: 240, y: 0 })
    // 第二行 y = 90 + 20
    expect(box(result.boxes, 'd')).toMatchObject({ x: 0, y: 110 })
  })

  it('grid 里整行都是 fill 高度时，该行均分容器剩余高度；columns 至少为 1', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'grid', columns: 0, gap: 10, size: { w: fixed(200), h: fixed(200) } }),
      child('a', 'root', 0, { size: { w: { kind: 'fill' }, h: { kind: 'fill' } } }),
    ])
    expect(box(computeLayout({ nodes, rootId: 'root' }).boxes, 'a')).toMatchObject({ x: 0, y: 0, w: 200, h: 200 })
  })
})

describe('M2 布局引擎：constraints 在宽度变化时的锚定', () => {
  function anchored(h: SceneNode['layout']['constraints']['h'], size = 200): Record<string, Box> {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(1440), h: fixed(900) } }),
      child('a', 'root', 0, {
        position: { x: 620, y: 100 },
        size: { w: fixed(size), h: fixed(100) },
        constraints: { h, v: 'top' },
      }),
    ])
    return computeLayout({ nodes, rootId: 'root', viewport: { w: 375, h: 900 }, reference: { w: 1440, h: 900 } }).boxes
  }

  it('left：左边距不变，尺寸不变', () => {
    expect(box(anchored('left'), 'a')).toEqual({ x: 620, y: 100, w: 200, h: 100 })
  })

  it('right：右边距不变', () => {
    // 原右边距 = 1440 - 620 - 200 = 620 → x = 375 - 620 - 200
    expect(box(anchored('right'), 'a')).toMatchObject({ x: -445, w: 200 })
  })

  it('left-right：左右边距都不变（宽度随之变化，负宽夹到 0）', () => {
    expect(box(anchored('left-right'), 'a')).toMatchObject({ x: 620, w: 0 })
  })

  it('center：中心点比例不变', () => {
    expect(box(anchored('center'), 'a').x).toBeCloseTo(620 + (375 - 1440) / 2)
  })

  it('scale：位置与尺寸按比例缩放', () => {
    const b = box(anchored('scale'), 'a')
    expect(b.x).toBeCloseTo(620 * (375 / 1440))
    expect(b.w).toBeCloseTo(200 * (375 / 1440))
  })

  it('v 轴同理：bottom 锚定底边距', () => {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(800), h: fixed(600) } }),
      child('a', 'root', 0, {
        position: { x: 0, y: 400 },
        size: { w: fixed(100), h: fixed(100) },
        constraints: { h: 'left', v: 'bottom' },
      }),
    ])
    // 原底边距 = 600 - 500 = 100 → y = 300 - 100 - 100
    const boxes = computeLayout({ nodes, rootId: 'root', viewport: { w: 800, h: 300 }, reference: { w: 800, h: 600 } }).boxes
    expect(box(boxes, 'a')).toMatchObject({ y: 100, h: 100 })
  })

  it('reference 缺省等于 viewport（不做约束换算）', () => {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(1440), h: fixed(900) } }),
      child('a', 'root', 0, { position: { x: 620, y: 100 }, size: { w: fixed(200), h: fixed(100) }, constraints: { h: 'right', v: 'top' } }),
    ])
    const boxes = computeLayout({ nodes, rootId: 'root', viewport: { w: 375, h: 900 } }).boxes
    expect(box(boxes, 'a')).toMatchObject({ x: 620 })
  })

  it('flow 模式不接受 h/v 锚定（位置由布局算法决定）', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'vertical', size: { w: fixed(1440), h: fixed(900) } }),
      child('a', 'root', 0, { constraints: { h: 'right', v: 'bottom' } }),
    ])
    const boxes = computeLayout({ nodes, rootId: 'root', viewport: { w: 375, h: 900 }, reference: { w: 1440, h: 900 } }).boxes
    expect(box(boxes, 'a')).toMatchObject({ x: 0, y: 0 })
  })
})

describe('M2 布局引擎：溢出与容错', () => {
  it('子元素超出父内容区时记进 overflow', () => {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(200), h: fixed(200) } }),
      child('inside', 'root', 0, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) } }),
      child('outside', 'root', 1, { position: { x: 180, y: 10 }, size: { w: fixed(100), h: fixed(50) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(result.overflow).toContain('outside')
    expect(result.overflow).not.toContain('inside')
  })

  it('parentId 指向不存在的节点时挂到根上（不丢盒）', () => {
    const nodes = makeNodes([frame('root', {}), makeNode({ id: 'orphan', parentId: 'ghost', order: 0 })])
    expect(box(computeLayout({ nodes, rootId: 'root' }).boxes, 'orphan')).toBeDefined()
  })

  it('环状父级不会死循环', () => {
    const nodes = makeNodes([
      frame('root', {}),
      makeNode({ id: 'a', parentId: 'b', order: 0 }),
      makeNode({ id: 'b', parentId: 'a', order: 0 }),
    ])
    expect(box(computeLayout({ nodes, rootId: 'root' }).boxes, 'root')).toBeDefined()
  })
})
