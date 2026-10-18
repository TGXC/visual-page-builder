import { describe, expect, it } from 'vitest'
import {
  baseBreakpointId,
  breakpointViewport,
  cascadeIds,
  effectiveNode,
  effectiveNodes,
  effectivePage,
  inferConstraints,
  inferPageConstraints,
  mediaQueryForBreakpoint,
  nodesForLayout,
  orderedBreakpoints,
  overrideFlags,
  writeOverride,
} from '@/core/responsive'
import { DEFAULT_BREAKPOINTS } from '@/core/schema/catalog'
import type { Breakpoint, BreakpointId, SceneNode } from '@/core/schema/types'
import { makeNode, makeNodes, makePage } from './factories'

const BPS: Breakpoint[] = DEFAULT_BREAKPOINTS.map((bp) => ({ ...bp }))
const withDisabled = (id: BreakpointId, enabled: boolean): Breakpoint[] =>
  BPS.map((bp) => (bp.id === id ? { ...bp, enabled } : { ...bp }))

/** 根 frame + 一个 rect 子节点，rect 带全量样式便于测差异合并 */
function scene(): { root: SceneNode; child: SceneNode } {
  const root = makeNode({ id: 'root', type: 'frame' })
  const child = makeNode({
    id: 'card',
    parentId: 'root',
    layout: { ...root.layout, position: { x: 10, y: 20 }, size: { w: { kind: 'fixed', value: 300 }, h: { kind: 'fixed', value: 200 } } },
    style: { ...root.style, bg: '#ffffff', fontSize: 14 },
    props: { text: 'hi' },
  })
  return { root, child }
}

describe('断点定义与级联顺序', () => {
  it('orderedBreakpoints 按 minWidth 从宽到窄，且过滤未启用', () => {
    expect(orderedBreakpoints(BPS).map((bp) => bp.id)).toEqual(['desktop', 'tablet', 'mobile'])
    expect(orderedBreakpoints(withDisabled('tablet', false)).map((bp) => bp.id)).toEqual(['desktop', 'mobile'])
  })

  it('baseBreakpointId 取最宽的启用断点，全禁用时为 null', () => {
    expect(baseBreakpointId(BPS)).toBe('desktop')
    expect(baseBreakpointId(BPS.map((bp) => ({ ...bp, enabled: false })))).toBeNull()
  })

  it('cascadeIds 返回「从基准到目标」的继承链，目标未知或未启用时为空', () => {
    expect(cascadeIds(BPS, 'desktop')).toEqual(['desktop'])
    expect(cascadeIds(BPS, 'tablet')).toEqual(['desktop', 'tablet'])
    expect(cascadeIds(BPS, 'mobile')).toEqual(['desktop', 'tablet', 'mobile'])
    expect(cascadeIds(BPS, 'watch')).toEqual([])
    expect(cascadeIds(withDisabled('tablet', false), 'mobile')).toEqual(['desktop', 'mobile'])
  })

  it('breakpointViewport 给预设宽高，自定义断点按 minWidth 兜底', () => {
    expect(breakpointViewport(BPS[0])).toEqual({ w: 1440, h: 900 })
    expect(breakpointViewport(BPS[1])).toEqual({ w: 768, h: 1024 })
    expect(breakpointViewport(BPS[2])).toEqual({ w: 375, h: 812 })
    expect(breakpointViewport({ id: 'wide', label: '超宽', minWidth: 1920, enabled: true })).toEqual({ w: 1920, h: 900 })
    expect(breakpointViewport({ id: 'tiny', label: '极小', minWidth: 0, enabled: true })).toEqual({ w: 375, h: 812 })
  })

  it('mediaQueryForBreakpoint：基准断点无查询，其余取「更宽一级 minWidth - 0.02」', () => {
    expect(mediaQueryForBreakpoint(BPS, 'desktop')).toBeNull()
    expect(mediaQueryForBreakpoint(BPS, 'tablet')).toBe('@media (max-width: 1199.98px)')
    expect(mediaQueryForBreakpoint(BPS, 'mobile')).toBe('@media (max-width: 767.98px)')
    expect(mediaQueryForBreakpoint(withDisabled('tablet', false), 'mobile')).toBe(
      '@media (max-width: 1199.98px)',
    )
    expect(mediaQueryForBreakpoint(BPS, 'watch')).toBeNull()
  })
})

describe('有效节点求解：overrides 逐级合并', () => {
  it('没有覆盖时有效节点等于原节点（每次都返回新对象，不共享引用）', () => {
    const { child } = scene()
    const effective = effectiveNode(child, BPS, 'mobile')
    expect(effective).toEqual(child)
    expect(effective).not.toBe(child)
    expect(effective.style).not.toBe(child.style)
    expect(effective.overrides).toEqual({})
  })

  it('手机断点继承「桌面 + 平板 + 手机」三层，平板覆盖不漏到桌面', () => {
    const { child } = scene()
    const node: SceneNode = {
      ...child,
      overrides: {
        tablet: { style: { fontSize: 18 } },
        mobile: { style: { fontSize: 22 } },
      },
    }
    expect(effectiveNode(node, BPS, 'desktop').style.fontSize).toBe(14)
    expect(effectiveNode(node, BPS, 'tablet').style.fontSize).toBe(18)
    expect(effectiveNode(node, BPS, 'mobile').style.fontSize).toBe(22)
  })

  it('layout 只覆盖差异字段，其余字段保留（含嵌套 position/padding）', () => {
    const { child } = scene()
    const node: SceneNode = {
      ...child,
      overrides: {
        mobile: {
          layout: {
            mode: 'vertical',
            position: { x: 99, y: 88 },
            padding: { top: 1, right: 2, bottom: 3, left: 4 },
          },
        },
      },
    }
    const mobile = effectiveNode(node, BPS, 'mobile')
    expect(mobile.layout.mode).toBe('vertical')
    expect(mobile.layout.position).toEqual({ x: 99, y: 88 })
    expect(mobile.layout.padding).toEqual({ top: 1, right: 2, bottom: 3, left: 4 })
    // size 没被这次覆盖碰到，必须原样保留
    expect(mobile.layout.size).toEqual(child.layout.size)
  })

  it('props 逐键合并；hidden 覆盖写进 meta.hidden；order 覆盖生效', () => {
    const { child } = scene()
    const node: SceneNode = {
      ...child,
      overrides: {
        tablet: { props: { text: 'pad' }, hidden: true, order: 5 },
        mobile: { props: { src: 'a.png' } },
      },
    }
    const tablet = effectiveNode(node, BPS, 'tablet')
    expect(tablet.props).toEqual({ text: 'pad' })
    expect(tablet.meta.hidden).toBe(true)
    expect(tablet.order).toBe(5)
    const mobile = effectiveNode(node, BPS, 'mobile')
    expect(mobile.props).toEqual({ text: 'pad', src: 'a.png' })
    expect(mobile.meta.hidden).toBe(true)
    expect(mobile.order).toBe(5)
  })

  it('有效节点不影响原节点（纯函数）', () => {
    const { child } = scene()
    const node: SceneNode = { ...child, overrides: { mobile: { style: { bg: '#000000' } } } }
    effectiveNode(node, BPS, 'mobile')
    expect(node.style.bg).toBe('#ffffff')
    expect(node.overrides).toEqual({ mobile: { style: { bg: '#000000' } } })
  })

  it('effectiveNodes / effectivePage 对整棵树与整页求解，页面其它字段不变', () => {
    const { root, child } = scene()
    const node: SceneNode = { ...child, overrides: { mobile: { hidden: true } } }
    const nodes = makeNodes([root, node])
    const page = makePage({ id: 'page_1', nodes })
    const resolved = effectiveNodes(nodes, BPS, 'mobile')
    expect(resolved.card.meta.hidden).toBe(true)
    expect(resolved.root.meta.hidden).toBe(false)
    const effective = effectivePage(page, BPS, 'mobile')
    expect(effective.id).toBe('page_1')
    expect(effective.root).toBe('root')
    expect(effective.viewport).toEqual(page.viewport)
    expect(effective.nodes.card.meta.hidden).toBe(true)
    expect(effective.nodes.root).toBeDefined()
  })
})

describe('writeOverride：只存差异', () => {
  it('基准断点不写覆盖（编辑直接落在节点上）', () => {
    const { child } = scene()
    expect(writeOverride(child, BPS, 'desktop', { style: { fontSize: 20 } })).toBeNull()
  })

  it('手机断点改样式：只记与「更宽一级有效值」不同的键，改回原值则覆盖消失', () => {
    const { child } = scene()
    const override = writeOverride(child, BPS, 'mobile', { style: { fontSize: 22 } })
    expect(override).toEqual({ style: { fontSize: 22 } })
    expect(writeOverride(child, BPS, 'mobile', { style: { fontSize: 14 } })).toBeNull()
  })

  it('继承链参与差异判定：平板的 18 已存在时，手机写 18 不产生覆盖', () => {
    const { child } = scene()
    const node: SceneNode = { ...child, overrides: { tablet: { style: { fontSize: 18 } } } }
    expect(writeOverride(node, BPS, 'mobile', { style: { fontSize: 18 } })).toBeNull()
    expect(writeOverride(node, BPS, 'mobile', { style: { fontSize: 20 } })).toEqual({ style: { fontSize: 20 } })
  })

  it('已有覆盖的其它键被保留（连续编辑不同属性时不能互相抹掉）', () => {
    const { child } = scene()
    const node: SceneNode = { ...child, overrides: { mobile: { style: { fontSize: 22 } } } }
    const override = writeOverride(node, BPS, 'mobile', { style: { bg: '#eeeeee' } })
    expect(override).toEqual({ style: { fontSize: 22, bg: '#eeeeee' } })
  })

  it('props 与 layout 分别按「改名键 / 改字段」记差异，hidden 与 order 也是', () => {
    const { child } = scene()
    const override = writeOverride(child, BPS, 'tablet', {
      props: { text: 'pad' },
      layout: { mode: 'horizontal', gap: 12 },
      hidden: true,
    })
    expect(override).toEqual({
      props: { text: 'pad' },
      layout: { mode: 'horizontal', gap: 12 },
      hidden: true,
    })
    expect(writeOverride(child, BPS, 'tablet', { hidden: false })).toBeNull()
  })

  it('overrideFlags 标出哪些类别有覆盖，供 UI 打点', () => {
    const { child } = scene()
    const node: SceneNode = {
      ...child,
      overrides: {
        tablet: { style: { fontSize: 18 } },
        mobile: { layout: { gap: 4 }, props: { text: 'x' }, hidden: true, order: 2 },
      },
    }
    expect(overrideFlags(node, 'desktop')).toEqual({
      layout: false,
      style: false,
      props: false,
      hidden: false,
      order: false,
      empty: true,
    })
    expect(overrideFlags(node, 'tablet')).toEqual({
      layout: false,
      style: true,
      props: false,
      hidden: false,
      order: false,
      empty: false,
    })
    expect(overrideFlags(node, 'mobile')).toEqual({
      layout: true,
      style: false,
      props: true,
      hidden: true,
      order: true,
      empty: false,
    })
  })
})

describe('M23 按几何推断锚定（constraints）', () => {
  const content = { x: 0, y: 0, w: 1000, h: 600 }

  it('整宽块拉伸、贴右边、居中、贴底各自推断成对应锚定', () => {
    expect(inferConstraints({ x: 0, y: 0, w: 1000, h: 100 }, content)).toEqual({ h: 'left-right', v: 'top' })
    expect(inferConstraints({ x: 800, y: 10, w: 200, h: 100 }, content)).toEqual({ h: 'right', v: 'top' })
    expect(inferConstraints({ x: 400, y: 10, w: 200, h: 100 }, content)).toEqual({ h: 'center', v: 'top' })
    expect(inferConstraints({ x: 20, y: 500, w: 200, h: 100 }, content)).toEqual({ h: 'left', v: 'bottom' })
    expect(inferConstraints({ x: 20, y: 0, w: 200, h: 600 }, content)).toEqual({ h: 'left', v: 'top-bottom' })
    // 什么都不贴、也不居中：保守地留在左上角（等于原来的行为）
    expect(inferConstraints({ x: 120, y: 130, w: 200, h: 100 }, content)).toEqual({ h: 'left', v: 'top' })
  })

  it('推断不产生 scale（等比缩放留着手动选）', () => {
    for (const w of [50, 200, 500, 900, 1000]) {
      expect(inferConstraints({ x: 10, y: 10, w, h: 100 }, content).h).not.toBe('scale')
    }
  })

  it('inferPageConstraints 在基准断点跑布局，按父内容框给出每个节点的建议', () => {
    const root = makeNode({ id: 'root', type: 'frame', layout: { ...makeNode({ id: 'root' }).layout, size: { w: { kind: 'fill' }, h: { kind: 'fill' } } } })
    const centered = makeNode({
      id: 'centered',
      parentId: 'root',
      layout: { ...root.layout, position: { x: 450, y: 10 }, size: { w: { kind: 'fixed', value: 100 }, h: { kind: 'fixed', value: 100 } } },
    })
    const nodes = makeNodes([root, centered])
    const inferred = inferPageConstraints(nodes, 'root', { w: 1000, h: 600 })
    expect(inferred.centered).toEqual({ h: 'center', v: 'top' })
    expect(inferred.root).toBeUndefined()
  })

  it('nodesForLayout：手动改过位置/尺寸的节点被钉成 left/top，显式选过锚定的不钉', () => {
    const base = makeNode({ id: 'root', type: 'frame' })
    const child = makeNode({
      id: 'card',
      parentId: 'root',
      layout: { ...base.layout, constraints: { h: 'center', v: 'bottom' } },
      overrides: { mobile: { layout: { position: { x: 5, y: 5 } } } },
    })
    const nodes = makeNodes([base, child])
    expect(nodesForLayout(nodes, BPS, 'mobile').card.layout.constraints).toEqual({ h: 'left', v: 'top' })
    // 基准断点没有覆盖，保持原锚定
    expect(nodesForLayout(nodes, BPS, 'desktop').card.layout.constraints).toEqual({ h: 'center', v: 'bottom' })
    // 用户在手机上显式选了「水平居中」：手动锚定优先，不再钉 left/top
    const anchored = {
      ...child,
      overrides: {
        mobile: {
          layout: { position: { x: 5, y: 5 }, constraints: { h: 'center' as const, v: 'bottom' as const } },
        },
      },
    }
    expect(nodesForLayout(makeNodes([base, anchored]), BPS, 'mobile').card.layout.constraints.h).toBe('center')
  })
})
