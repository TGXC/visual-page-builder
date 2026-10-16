import { describe, expect, it } from 'vitest'
import type { Box, SceneNode } from '@/core/schema/types'
import { computeLayout, estimateTextSize } from '@/core/layout'
import { makeNode, makeNodes } from './factories'

/**
 * M2 布局引擎的边角分支：断点约束、ratio 的两个轴、hug 容器长大重排、grid 行高分配、
 * 水平折行、溢出标记、富余空间不足时的兜底。
 *
 * 这些分支要么是「换个视口就会走到」的真实路径，要么是脏数据的兜底，
 * 单靠主干用例覆盖不到，所以单独一个文件按分支列。
 */

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

describe('M2 布局引擎：入口与尺寸兜底', () => {
  it('根节点不存在时返回空结果，不抛错', () => {
    const result = computeLayout({ nodes: {}, rootId: 'missing' })
    expect(result).toEqual({ boxes: {}, estimated: [], overflow: [] })
  })

  it('estimateTextSize 会退回 meta.name，完全没文本时返回 0', () => {
    const named = makeNode({ id: 'n1', type: 'text' })
    named.layout.padding = { top: 2, right: 3, bottom: 4, left: 5 }
    named.props = {}
    named.meta = { name: '标题', hidden: false, locked: false }
    const measured = estimateTextSize(named)
    expect(measured.w).toBeGreaterThan(5 + 3)
    expect(measured.h).toBeGreaterThan(2 + 4)

    const empty = makeNode({ id: 'n2', type: 'text' })
    empty.props = {}
    empty.meta = { hidden: false, locked: false }
    expect(estimateTextSize(empty)).toEqual({ w: 0, h: 0 })
  })

  it('两个轴都是 ratio 时以可用宽度为准，ratio 非法值按 1 处理', () => {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(400), h: fixed(300) } }),
      child('both', 'root', 0, { size: { w: { kind: 'ratio', value: 2 }, h: { kind: 'ratio', value: 4 } } }),
      child('wRatio', 'root', 1, { size: { w: { kind: 'ratio', value: 2 }, h: fixed(100) } }),
      child('badRatio', 'root', 2, { size: { w: fixed(120), h: { kind: 'ratio', value: 0 } } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })

    // 两轴 ratio：w = 可用宽 400，h = 400 / 4
    expect(box(result.boxes, 'both')).toMatchObject({ w: 400, h: 100 })
    // w 是 ratio、h 是 fixed：w = 100 * 2
    expect(box(result.boxes, 'wRatio')).toMatchObject({ w: 200, h: 100 })
    // ratio 为 0 时按 1 处理 → h = w
    expect(box(result.boxes, 'badRatio')).toMatchObject({ w: 120, h: 120 })
  })
})

describe('M2 布局引擎：断点 constraints', () => {
  const nodes = makeNodes([
    frame('root', { size: { w: fixed(600), h: fixed(400) } }),
    child('right', 'root', 0, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'right', v: 'top' } }),
    child('stretchH', 'root', 1, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'left-right', v: 'top' } }),
    child('centerH', 'root', 2, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'center', v: 'top' } }),
    child('scaleH', 'root', 3, { position: { x: 30, y: 30 }, size: { w: fixed(60), h: fixed(60) }, constraints: { h: 'scale', v: 'top' } }),
    child('bottom', 'root', 4, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'left', v: 'bottom' } }),
    child('stretchV', 'root', 5, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'left', v: 'top-bottom' } }),
    child('centerV', 'root', 6, { position: { x: 10, y: 10 }, size: { w: fixed(50), h: fixed(50) }, constraints: { h: 'left', v: 'center' } }),
    child('scaleV', 'root', 7, { position: { x: 30, y: 30 }, size: { w: fixed(60), h: fixed(60) }, constraints: { h: 'left', v: 'scale' } }),
    child('zeroScale', 'root', 8, { position: { x: 20, y: 20 }, size: { w: fixed(0), h: fixed(0) }, constraints: { h: 'scale', v: 'scale' } }),
  ])
  // 设计视口 600x400 → 当前 900x600：dw = 300，dh = 200
  const result = computeLayout({ nodes, rootId: 'root', viewport: { w: 900, h: 600 }, reference: { w: 600, h: 400 } })

  it('左右方向的四种锚定各自生效', () => {
    expect(box(result.boxes, 'right')).toMatchObject({ x: 310, y: 10 })
    expect(box(result.boxes, 'stretchH')).toMatchObject({ x: 10, w: 350 })
    expect(box(result.boxes, 'centerH')).toMatchObject({ x: 160 })
    // scale：s = 900/600 = 1.5 → x = 30 * 1.5、w = 60 * 1.5
    expect(box(result.boxes, 'scaleH')).toMatchObject({ x: 45, w: 90 })
  })

  it('上下方向的四种锚定各自生效', () => {
    expect(box(result.boxes, 'bottom')).toMatchObject({ y: 210 })
    expect(box(result.boxes, 'stretchV')).toMatchObject({ y: 10, h: 250 })
    expect(box(result.boxes, 'centerV')).toMatchObject({ y: 110 })
    expect(box(result.boxes, 'scaleV')).toMatchObject({ y: 45, h: 90 })
    // 尺寸是 0：位置照样按缩放系数走，尺寸仍是 0
    expect(box(result.boxes, 'zeroScale')).toMatchObject({ x: 30, y: 30, w: 0, h: 0 })
  })

  it('设计视口尺寸为 0 时缩放系数退化成 1，不把位置和尺寸乘成 0', () => {
    const zero = makeNodes([
      frame('root', { size: { w: fixed(0), h: fixed(0) } }),
      child('scaled', 'root', 0, { position: { x: 20, y: 20 }, size: { w: fixed(30), h: fixed(30) }, constraints: { h: 'scale', v: 'scale' } }),
    ])
    const scaled = computeLayout({ nodes: zero, rootId: 'root', viewport: { w: 900, h: 600 }, reference: { w: 0, h: 0 } })
    expect(box(scaled.boxes, 'scaled')).toMatchObject({ x: 20, y: 20, w: 30, h: 30 })
  })
})

describe('M2 布局引擎：hug 容器与富余空间兜底', () => {
  it('流式布局里 hug 的交叉轴容器按子节点长大并重排子树', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'vertical', size: { w: fixed(400), h: fixed(300) } }),
      child('box', 'root', 0, { size: { w: { kind: 'hug' }, h: fixed(50) } }),
      child('inner', 'box', 0, { position: { x: 10, y: 10 }, size: { w: fixed(200), h: fixed(20) } }),
      child('hugH', 'root', 1, { mode: 'vertical', size: { w: fixed(100), h: { kind: 'hug' } } }),
      child('hugChild', 'hugH', 0, { position: { x: 0, y: 0 }, size: { w: fixed(80), h: fixed(30) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })

    // hug 宽容器：按子节点并集（10 + 200）长大，子节点坐标仍相对容器内容框
    expect(box(result.boxes, 'box')).toMatchObject({ w: 210, h: 50 })
    expect(box(result.boxes, 'inner')).toMatchObject({ x: 10, y: 10, w: 200, h: 20 })
    // hug 高容器：主轴方向靠子节点并集（10 + 30 已是 40 → 30 + 10? 由子盒决定）
    expect(box(result.boxes, 'hugH').h).toBe(30)
  })

  it('富余空间不足时不给 fill 子节点分负数', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'horizontal', gap: 200, size: { w: fixed(100), h: fixed(200) } }),
      child('f1', 'root', 0, { size: { w: { kind: 'fill' }, h: fixed(20) } }),
      child('f2', 'root', 1, { size: { w: { kind: 'fill' }, h: fixed(20) } }),
      child('f3', 'root', 2, { size: { w: { kind: 'fill' }, h: fixed(20) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    for (const id of ['f1', 'f2', 'f3']) expect(box(result.boxes, id).w).toBeGreaterThanOrEqual(0)
  })

  it('超出父容器内容框的子节点被标记进 overflow', () => {
    const nodes = makeNodes([
      frame('root', { size: { w: fixed(200), h: fixed(200) } }),
      child('outside', 'root', 0, { position: { x: 150, y: 150 }, size: { w: fixed(100), h: fixed(100) } }),
      child('inside', 'root', 1, { position: { x: 10, y: 10 }, size: { w: fixed(20), h: fixed(20) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(result.overflow).toContain('outside')
    expect(result.overflow).not.toContain('inside')
  })
})

describe('M2 布局引擎：grid 与水平折行', () => {
  it('grid 列数为 0 时按 1 列，fill 行均分剩余高度，hug 宽高按内容量', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'grid', columns: 0, gap: 10, size: { w: fixed(210), h: fixed(300) } }),
      child('g1', 'root', 0, { size: { w: fixed(50), h: { kind: 'hug' } } }, { type: 'text', props: { text: 'aaa' } }),
      child('g2', 'root', 1, { size: { w: { kind: 'hug' }, h: { kind: 'fill' } } }, { type: 'card' }),
      child('g3', 'root', 2, { size: { w: { kind: 'fill' }, h: fixed(20) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    // columns 0 → 1 列：三个节点三行
    // g1：hug 高由文本内容量决定
    expect(box(result.boxes, 'g1').h).toBeGreaterThan(0)
    // g2：整行都是 fill 高（自然高 0）→ 剩余高度均分给它
    expect(box(result.boxes, 'g2').h).toBeGreaterThan(0)
    // g2 宽是 hug 且没有内容 → 0；g3 宽是 fill → 撑满单元
    expect(box(result.boxes, 'g2').w).toBe(0)
    expect(box(result.boxes, 'g3').w).toBe(210)
  })

  it('grid 的 justify/align 决定单元内的偏移', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'grid', columns: 2, gap: 0, justify: 'center', align: 'end', size: { w: fixed(200), h: fixed(200) } }),
      child('c1', 'root', 0, { size: { w: fixed(50), h: fixed(20) } }),
      child('c2', 'root', 1, { size: { w: fixed(50), h: fixed(50) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    // cellW = 100：水平居中 → x = 25；行高 50，align end 把矮的那个推到底 → y = 30
    expect(box(result.boxes, 'c1')).toMatchObject({ x: 25, y: 30 })
    expect(box(result.boxes, 'c2')).toMatchObject({ x: 125, y: 0 })

    const ended = makeNodes([
      frame('root', { mode: 'grid', columns: 2, gap: 0, justify: 'end', align: 'center', size: { w: fixed(200), h: fixed(200) } }),
      child('e1', 'root', 0, { size: { w: fixed(50), h: fixed(20) } }),
      child('e2', 'root', 1, { size: { w: fixed(50), h: fixed(60) } }),
    ])
    const endedResult = computeLayout({ nodes: ended, rootId: 'root' })
    // justify end → x = 50；行高 60，align center → y = 20
    expect(box(endedResult.boxes, 'e1')).toMatchObject({ x: 50, y: 20 })
    expect(box(endedResult.boxes, 'e2')).toMatchObject({ x: 150, y: 0 })
  })

  it('水平 wrap 折行：行高由本行最高的子节点决定，fill 的交叉轴撑满行高', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'horizontal', wrap: true, size: { w: fixed(120), h: fixed(300) } }),
      child('a', 'root', 0, { size: { w: fixed(60), h: fixed(40) } }),
      child('b', 'root', 1, { size: { w: fixed(60), h: { kind: 'fill' } } }),
      child('c', 'root', 2, { size: { w: fixed(60), h: fixed(40) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(box(result.boxes, 'a')).toMatchObject({ x: 0, y: 0, h: 40 })
    // 60 + 60 = 120 刚好放下：b 与本行同排，fill 撑到行高 40（而不是容器高 300）
    expect(box(result.boxes, 'b')).toMatchObject({ x: 60, y: 0, h: 40 })
    // c 放不下 → 折到第二行，y 累加第一行行高
    expect(box(result.boxes, 'c')).toMatchObject({ x: 0, y: 40, h: 40 })
  })

  it('space-between 与 center/end 的富余空间分配', () => {
    const spread = makeNodes([
      frame('root', { mode: 'horizontal', justify: 'space-between', size: { w: fixed(300), h: fixed(100) } }),
      child('s1', 'root', 0, { size: { w: fixed(50), h: fixed(50) } }),
      child('s2', 'root', 1, { size: { w: fixed(50), h: fixed(50) } }),
    ])
    const spreadResult = computeLayout({ nodes: spread, rootId: 'root' })
    expect(box(spreadResult.boxes, 's1').x).toBe(0)
    expect(box(spreadResult.boxes, 's2').x).toBe(250)

    const centered = makeNodes([
      frame('root', { mode: 'horizontal', justify: 'center', align: 'center', size: { w: fixed(300), h: fixed(100) } }),
      child('c1', 'root', 0, { size: { w: fixed(50), h: fixed(50) } }),
    ])
    const centeredResult = computeLayout({ nodes: centered, rootId: 'root' })
    expect(box(centeredResult.boxes, 'c1')).toMatchObject({ x: 125, y: 25 })

    const ended = makeNodes([
      frame('root', { mode: 'vertical', justify: 'end', align: 'end', size: { w: fixed(300), h: fixed(100) } }),
      child('e1', 'root', 0, { size: { w: fixed(50), h: fixed(50) } }),
    ])
    const endedResult = computeLayout({ nodes: ended, rootId: 'root' })
    expect(box(endedResult.boxes, 'e1')).toMatchObject({ x: 250, y: 50 })
  })

  it('align stretch 让子节点交叉轴撑满容器', () => {
    const nodes = makeNodes([
      frame('root', { mode: 'vertical', align: 'stretch', size: { w: fixed(300), h: fixed(100) } }),
      child('s', 'root', 0, { size: { w: fixed(50), h: fixed(20) } }),
    ])
    const result = computeLayout({ nodes, rootId: 'root' })
    expect(box(result.boxes, 's').w).toBe(300)
  })
})
