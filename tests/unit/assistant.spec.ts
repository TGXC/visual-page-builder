import { describe, expect, it } from 'vitest'
import type { Doc, SceneNode } from '@/core/schema/types'
import { applyPatches, invertPatches } from '@/core/patch'
import {
  SPACING_SCALE,
  auditDoc,
  contrastRatio,
  findPage,
  fixAll,
  parseColor,
  readableTextColor,
  relativeLuminance,
} from '@/core/assistant'
import { docWithNodes, makeDoc, makeNode, makePage, makeNodes, snapshot } from './factories'

const ROOT_LAYOUT = {
  mode: 'free' as const,
  position: { x: 0, y: 0 },
  size: { w: { kind: 'fixed' as const, value: 1440 }, h: { kind: 'fixed' as const, value: 900 } },
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: 0,
  columns: 1,
  align: 'start' as const,
  justify: 'start' as const,
  wrap: false,
  constraints: { h: 'left' as const, v: 'top' as const },
}

function root(): SceneNode {
  return makeNode({ id: 'root', type: 'frame', layout: ROOT_LAYOUT, style: { ...makeNode({ id: 'x' }).style, bg: '#FFFFFF' } })
}

function pageDoc(nodes: SceneNode[], breakpoints = [
  { id: 'desktop', label: '桌面', minWidth: 1200, enabled: true },
  { id: 'mobile', label: '手机', minWidth: 0, enabled: true },
]): Doc {
  return makeDoc({
    breakpoints,
    pages: [makePage({ id: 'page_1', root: 'root', nodes: makeNodes(nodes) })],
  })
}

/** 五个已知问题：溢出 / 对比度 / 间距 / 尺寸不一致 / 缺替代文字 */
function problemDoc(): Doc {
  return pageDoc([
    root(),
    makeNode({
      id: 't1',
      type: 'text',
      parentId: 'root',
      order: 0,
      props: { text: '低对比文字' },
      style: { ...makeNode({ id: 'x' }).style, color: '#999999' },
      // 让「断点未覆盖」这条静默，专测另外五条
      overrides: { mobile: { style: { fontSize: 14 } } },
    }),
    makeNode({ id: 'img1', type: 'image', parentId: 'root', order: 1 }),
    makeNode({
      id: 'sec1',
      type: 'section',
      parentId: 'root',
      order: 2,
      layout: { ...ROOT_LAYOUT, size: { w: { kind: 'fixed', value: 400 }, h: { kind: 'fixed', value: 200 } }, padding: { top: 10, right: 0, bottom: 0, left: 0 } },
    }),
    makeNode({ id: 'r0', type: 'rect', parentId: 'sec1', order: 0 }),
    makeNode({ id: 'b1', type: 'button', parentId: 'root', order: 3, layout: { ...ROOT_LAYOUT, position: { x: 20, y: 600 }, size: { w: { kind: 'fixed', value: 120 }, h: { kind: 'fixed', value: 40 } } } }),
    makeNode({ id: 'b2', type: 'button', parentId: 'root', order: 4, layout: { ...ROOT_LAYOUT, position: { x: 160, y: 600 }, size: { w: { kind: 'fixed', value: 120 }, h: { kind: 'fixed', value: 40 } } } }),
    makeNode({ id: 'b3', type: 'button', parentId: 'root', order: 5, layout: { ...ROOT_LAYOUT, position: { x: 300, y: 600 }, size: { w: { kind: 'fixed', value: 160 }, h: { kind: 'fixed', value: 40 } } } }),
    makeNode({ id: 'ov1', type: 'rect', parentId: 'root', order: 6, layout: { ...ROOT_LAYOUT, position: { x: 1400, y: 20 } } }),
  ])
}

describe('颜色与对比度', () => {
  it('WCAG 对比度：黑白 21:1，同色 1:1，中灰约 4.5:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  it('解析 #rgb / #rrggbb / rgb() / rgba()，其它格式当没设置', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#3B82F6')).toEqual({ r: 59, g: 130, b: 246 })
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColor('tomato')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })

  it('修复色永远满足 AA（黑白二选一里取对比更高的）', () => {
    for (const bg of ['#FFFFFF', '#000000', '#3B82F6', '#999999', '#F8FAFC', '#1E293B']) {
      expect(contrastRatio(readableTextColor(bg), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('规则式检查（AI3）', () => {
  it('五类已知问题各报一条，且每条都带可执行修复', () => {
    const issues = auditDoc(problemDoc(), 'page_1')

    expect(issues.map((issue) => issue.kind).sort()).toEqual([
      'contrast',
      'missing-alt',
      'overflow',
      'size-inconsistent',
      'spacing',
    ])
    expect(issues.every((issue) => issue.patches.length > 0)).toBe(true)
    expect(issues.every((issue) => issue.message.length > 0 && issue.fixLabel.length > 0)).toBe(true)
    // 溢出那条：算出「夹回容器内」的新位置
    const overflow = issues.find((issue) => issue.kind === 'overflow')
    expect(overflow?.nodeId).toBe('ov1')
    expect(overflow?.patches[0]).toMatchObject({ op: 'update', id: 'ov1' })
  })

  it('逐条修复后清零，且补丁可逆（逆序回滚回原文档）', () => {
    const doc = problemDoc()
    const issues = auditDoc(doc, 'page_1')

    let fixed = doc
    for (const issue of issues) fixed = applyPatches(fixed, issue.patches)
    expect(auditDoc(fixed, 'page_1')).toEqual([])

    // 逆序应用逆补丁 == 历史里连续撤销
    let rolled = fixed
    for (const issue of [...issues].reverse()) rolled = applyPatches(rolled, invertPatches(issue.patches))
    expect(snapshot(rolled)).toBe(snapshot(doc))
  })

  it('一键修复全部：一次补齐五类问题，再查为空', () => {
    const doc = problemDoc()
    const patches = fixAll(doc, 'page_1')
    expect(patches.length).toBeGreaterThanOrEqual(5)

    const fixed = applyPatches(doc, patches)
    expect(auditDoc(fixed, 'page_1')).toEqual([])
  })

  it('断点未覆盖：窄断点整页无覆盖时报一条，修复后消失', () => {
    const doc = docWithNodes([root(), makeNode({ id: 'a', type: 'rect', parentId: 'root', order: 0 })])
    const issues = auditDoc(doc, 'page_1')
    const uncovered = issues.filter((issue) => issue.kind === 'breakpoint-uncovered')

    expect(uncovered.map((issue) => issue.id)).toEqual([
      'breakpoint-uncovered:tablet',
      'breakpoint-uncovered:mobile',
    ])
    const fixed = applyPatches(doc, fixAll(doc, 'page_1'))
    expect(auditDoc(fixed, 'page_1')).toEqual([])
  })

  it('干净页面不报问题；间距阶梯与主题 token 对得上', () => {
    const doc = pageDoc([
      root(),
      makeNode({ id: 'a', type: 'rect', parentId: 'root', order: 0 }),
      makeNode({
        id: 'box',
        type: 'section',
        parentId: 'root',
        order: 1,
        layout: { ...ROOT_LAYOUT, size: { w: { kind: 'fixed', value: 300 }, h: { kind: 'fixed', value: 400 } }, padding: { top: 16, right: 16, bottom: 16, left: 16 }, gap: 8, mode: 'vertical' },
      }),
      makeNode({ id: 'b0', type: 'text', parentId: 'box', order: 0, props: { text: '普通文字' } }),
      makeNode({
        id: 'photo',
        type: 'image',
        parentId: 'box',
        order: 1,
        props: { text: '产品照片', alt: '产品照片' },
        overrides: { mobile: { style: { fontSize: 12 } } },
      }),
      makeNode({ id: 'p2', type: 'rect', parentId: 'root', order: 2, overrides: { mobile: { hidden: true } } }),
    ])

    expect(SPACING_SCALE).toEqual([0, 4, 8, 12, 16, 24, 32, 48, 64])
    expect(auditDoc(doc, 'page_1')).toEqual([])
    expect(findPage(doc, 'nope')?.id).toBe('page_1')
    expect(findPage(doc)?.id).toBe('page_1')
  })
})
