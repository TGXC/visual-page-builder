import { describe, expect, it } from 'vitest'
import type { Box } from '@/core/schema/types'
import {
  HANDLES,
  SNAP_THRESHOLD,
  applySnap,
  boxContains,
  moveBy,
  rectOf,
  rectsIntersect,
  resizeBox,
  topmostHit,
  unionBox,
} from '@/core/geometry'
import { makeNode } from './factories'

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

describe('rectOf / moveBy', () => {
  it('从 free 布局节点取出盒子', () => {
    const node = makeNode({
      id: 'a',
      layout: {
        ...makeNode({ id: 'a' }).layout,
        position: { x: 40, y: 60 },
        size: { w: { kind: 'fixed', value: 200 }, h: { kind: 'fixed', value: 80 } },
      },
    })

    expect(rectOf(node)).toEqual(box(40, 60, 200, 80))
  })

  it('fill / hug 这类没有固定像素的尺寸按 0 处理（M2 布局引擎才会算出真实盒子）', () => {
    const node = makeNode({
      id: 'a',
      layout: { ...makeNode({ id: 'a' }).layout, size: { w: { kind: 'fill' }, h: { kind: 'hug' } } },
    })

    expect(rectOf(node)).toEqual(box(0, 0, 0, 0))
  })

  it('平移不改变尺寸，且不修改入参', () => {
    const start = box(10, 20, 30, 40)
    expect(moveBy(start, 5, -5)).toEqual(box(15, 15, 30, 40))
    expect(start).toEqual(box(10, 20, 30, 40))
  })
})

describe('resizeBox：8 向手柄', () => {
  const start = box(100, 100, 200, 100)

  it('暴露 8 个手柄', () => {
    expect(HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
  })

  it('se 向右下：只增大宽高', () => {
    expect(resizeBox(start, 'se', 20, 30)).toEqual(box(100, 100, 220, 130))
  })

  it('nw 向左上：原点跟着移动，宽高增大', () => {
    expect(resizeBox(start, 'nw', -20, -10)).toEqual(box(80, 90, 220, 110))
  })

  it('e / w / n / s 只改一个方向', () => {
    expect(resizeBox(start, 'e', 20, 999)).toEqual(box(100, 100, 220, 100))
    expect(resizeBox(start, 's', 999, 20)).toEqual(box(100, 100, 200, 120))
    expect(resizeBox(start, 'w', -20, 0)).toEqual(box(80, 100, 220, 100))
    expect(resizeBox(start, 'n', 0, -20)).toEqual(box(100, 80, 200, 120))
  })

  it('小于最小尺寸时夹住，且左/上边缘锚定（不会把盒子拖反）', () => {
    const tiny = resizeBox(start, 'w', 500, 0, { minW: 20 })
    expect(tiny.w).toBe(20)
    expect(tiny.x).toBe(280)

    const thin = resizeBox(start, 'n', 0, 500, { minH: 20 })
    expect(thin.h).toBe(20)
    expect(thin.y).toBe(180)
  })

  it('Shift 等比：角手柄保持原始宽高比', () => {
    const grown = resizeBox(start, 'se', 100, 0, { keepRatio: true })
    expect(grown.w / grown.h).toBeCloseTo(2, 5)
    expect(grown.h).toBeCloseTo(150, 5)
  })
})

describe('矩形关系', () => {
  it('rectsIntersect：相交为真，仅贴边为假', () => {
    expect(rectsIntersect(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true)
    expect(rectsIntersect(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false)
    expect(rectsIntersect(box(0, 0, 10, 10), box(20, 20, 5, 5))).toBe(false)
    expect(rectsIntersect(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBe(true)
  })

  it('unionBox：空数组返回 null，否则是最小包围盒', () => {
    expect(unionBox([])).toBeNull()
    expect(unionBox([box(0, 0, 10, 10)])).toEqual(box(0, 0, 10, 10))
    expect(unionBox([box(0, 0, 10, 10), box(20, 30, 10, 10)])).toEqual(box(0, 0, 30, 40))
  })

  it('boxContains：含边界，部分重叠不算包含', () => {
    expect(boxContains(box(0, 0, 100, 100), box(0, 0, 100, 100))).toBe(true)
    expect(boxContains(box(0, 0, 100, 100), box(50, 50, 50, 50))).toBe(true)
    expect(boxContains(box(0, 0, 100, 100), box(50, 50, 60, 60))).toBe(false)
  })
})

describe('applySnap：6px 磁吸', () => {
  it('阈值内吸附到目标的左边缘，并给出参考线', () => {
    const targets = { x: [120], y: [] }
    const result = applySnap(box(116, 0, 40, 40), targets)

    expect(result.box.x).toBe(120)
    expect(result.guides).toEqual([{ axis: 'x', at: 120 }])
  })

  it('超出阈值不动，也不给参考线', () => {
    const result = applySnap(box(60, 0, 40, 40), { x: [120], y: [] })

    expect(result.box).toEqual(box(60, 0, 40, 40))
    expect(result.guides).toEqual([])
  })

  it('中心对中心也算吸附（左/中/右三条边都参与比较）', () => {
    // 盒子中心 120，目标线 122 → 差值 2，落点后中心与线对齐
    const result = applySnap(box(100, 0, 40, 40), { x: [122], y: [] })

    expect(result.box.x).toBe(102)
    expect(result.guides).toEqual([{ axis: 'x', at: 122 }])
  })

  it('两个轴可以同时吸附', () => {
    const result = applySnap(box(98, 48, 40, 40), { x: [100], y: [50] })

    expect(result.box.x).toBe(100)
    expect(result.box.y).toBe(50)
    expect(result.guides).toHaveLength(2)
  })

  it('多个候选里取最近的；没有目标时原样返回', () => {
    const near = applySnap(box(96, 0, 40, 40), { x: [90, 100], y: [] })
    expect(near.box.x).toBe(100)
    expect(applySnap(box(97, 0, 40, 40), { x: [], y: [] }).box).toEqual(box(97, 0, 40, 40))
  })

  it('默认阈值就是 6', () => {
    expect(SNAP_THRESHOLD).toBe(6)
    expect(applySnap(box(94, 0, 40, 40), { x: [100], y: [] }).box.x).toBe(100)
    expect(applySnap(box(93, 0, 40, 40), { x: [100], y: [] }).box.x).toBe(93)
  })
})

describe('topmostHit：点中哪个节点', () => {
  const entries = [
    { id: 'frame', box: box(0, 0, 600, 400), depth: 0 },
    { id: 'card', box: box(20, 20, 200, 100), depth: 1 },
    { id: 'text', box: box(40, 40, 100, 20), depth: 2 },
    { id: 'sibling', box: box(40, 40, 100, 20), depth: 2 },
  ]

  it('取命中点里层级最深的那个', () => {
    expect(topmostHit(entries, { x: 50, y: 45 })).toBe('sibling')
    expect(topmostHit(entries, { x: 150, y: 90 })).toBe('card')
    expect(topmostHit(entries, { x: 500, y: 300 })).toBe('frame')
  })

  it('同层级时取列表里靠后的（渲染在上面的）', () => {
    const two = [
      { id: 'below', box: box(0, 0, 10, 10), depth: 0 },
      { id: 'above', box: box(0, 0, 10, 10), depth: 0 },
    ]
    expect(topmostHit(two, { x: 5, y: 5 })).toBe('above')
  })

  it('没命中返回 null', () => {
    expect(topmostHit(entries, { x: 999, y: 999 })).toBeNull()
    expect(topmostHit([], { x: 0, y: 0 })).toBeNull()
  })
})
