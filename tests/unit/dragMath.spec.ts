import { describe, expect, it } from 'vitest'
import { EDGE_SCROLL_STEP, findDropIndex, toCanvasPoint } from '@/composables/useDragField'
import { edgeScrollDelta } from '@/composables/useDragField'
import { normalizeDropIndex, visualIndexToOrder } from '@/composables/useSortable'
import { makeField, makeSchema } from './factories'

const rect = (top: number, height: number, left = 0, width = 600) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
})

/** 只实现被测量函数用到的那部分 DOM 接口，避免为了数学测试去搭真 DOM。 */
const box = (top: number, height: number, left = 0) => ({
  getBoundingClientRect: () => rect(top, height, left) as DOMRect,
})

const scrollable = (top: number, height: number) => ({
  ...box(top, height),
  scrollLeft: 10,
  scrollTop: 20,
})

describe('toCanvasPoint：指针位置换算到画布坐标系', () => {
  it('scale=1 时 = (client - rect + scroll)', () => {
    const canvas = scrollable(50, 400)
    // left=0 top=50，clientY=100 → 100-50+20 = 70
    expect(toCanvasPoint({ clientX: 150, clientY: 100 }, canvas, 1)).toEqual({ x: 160, y: 70 })
  })

  it('缩放时结果要除以 scale（画布是 transform: scale 放大的）', () => {
    const canvas = scrollable(50, 400)
    expect(toCanvasPoint({ clientX: 150, clientY: 100 }, canvas, 0.5)).toEqual({ x: 320, y: 140 })
  })
})

describe('findDropIndex：指针落在第几个插入位', () => {
  const els = [box(0, 60), box(60, 60), box(120, 60)] // 中点 30 / 90 / 150

  it('在中点之上就插在它前面', () => {
    expect(findDropIndex(-10, els)).toBe(0)
    expect(findDropIndex(20, els)).toBe(0)
    expect(findDropIndex(50, els)).toBe(1)
    expect(findDropIndex(100, els)).toBe(2)
  })

  it('低于所有中点就插在最后', () => {
    expect(findDropIndex(200, els)).toBe(3)
  })

  it('没有字段时只有位置 0', () => {
    expect(findDropIndex(200, [])).toBe(0)
  })
})

describe('edgeScrollDelta：靠近上下边缘自动滚动', () => {
  const scroller = box(0, 400)

  it('上边缘返回负步长、下边缘返回正步长、中间不动', () => {
    expect(edgeScrollDelta(20, scroller)).toBe(-EDGE_SCROLL_STEP)
    expect(edgeScrollDelta(390, scroller)).toBe(EDGE_SCROLL_STEP)
    expect(edgeScrollDelta(200, scroller)).toBe(0)
  })

  it('正好在边缘带之外不滚动（40px 是开区间）', () => {
    expect(edgeScrollDelta(40, scroller)).toBe(0)
    expect(edgeScrollDelta(360, scroller)).toBe(0)
  })
})

describe('normalizeDropIndex：同父级拖拽要把自己先从列表里摘掉', () => {
  it('新建字段（没有拖拽源）直接用视觉下标', () => {
    expect(normalizeDropIndex(2, null)).toBe(2)
  })

  it('往下拖：落点在自己之后要多减 1', () => {
    expect(normalizeDropIndex(3, 0)).toBe(2)
  })

  it('往上拖：落点在自己之前不用减', () => {
    expect(normalizeDropIndex(0, 2)).toBe(0)
  })

  it('原地放下不变', () => {
    expect(normalizeDropIndex(1, 1)).toBe(1)
  })
})

describe('visualIndexToOrder：落点换算成补丁里的 order', () => {
  const schema = makeSchema([
    makeField({ type: 'text', name: 'a', order: 0 }),
    makeField({ type: 'text', name: 'b', order: 1 }),
    makeField({ type: 'text', name: 'c', order: 2 }),
  ])
  const fields = schema.fields
  const [a, , c] = fields

  it('新建：插在中间', () => {
    expect(visualIndexToOrder(fields, null, 1, null)).toBe(1)
  })

  it('新建：插在末尾，越界要裁剪', () => {
    expect(visualIndexToOrder(fields, null, 3, null)).toBe(3)
    expect(visualIndexToOrder(fields, null, 99, null)).toBe(3)
  })

  it('移动：第一个拖到末尾', () => {
    expect(visualIndexToOrder(fields, null, 3, a.id)).toBe(2)
  })

  it('移动：最后一个拖到开头', () => {
    expect(visualIndexToOrder(fields, null, 0, c.id)).toBe(0)
  })

  it('移动：越界时上限是「剩下来的位置数」', () => {
    expect(visualIndexToOrder(fields, null, 99, a.id)).toBe(2)
  })
})
