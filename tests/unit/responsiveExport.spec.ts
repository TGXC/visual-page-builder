import { describe, expect, it } from 'vitest'
import { generateHtml, generateResponsiveCss, inlineStyle } from '@/core/codegen'
import { computeLayout } from '@/core/layout'
import { DEFAULT_BREAKPOINTS } from '@/core/schema/catalog'
import type { Doc, SceneNode } from '@/core/schema/types'
import { makeDoc, makeNode, makeNodes, makePage } from './factories'

/** 根 vertical frame → grid 容器（3 列）→ 3 个 fill 子块 */
function scene(): { doc: Doc; pageId: string; containerId: string; childIds: string[] } {
  const root = makeNode({
    id: 'root',
    type: 'frame',
    layout: { ...makeNode({ id: 'root' }).layout, mode: 'vertical', padding: { top: 10, right: 10, bottom: 10, left: 10 } },
    style: { ...makeNode({ id: 'root' }).style, bg: '#f8fafc' },
  })
  const container = makeNode({
    id: 'grid',
    parentId: 'root',
    order: 0,
    layout: {
      ...root.layout,
      mode: 'grid',
      columns: 3,
      gap: 10,
      size: { w: { kind: 'fill' }, h: { kind: 'hug' } },
    },
  })
  const children: SceneNode[] = [0, 1, 2].map((index) =>
    makeNode({
      id: `c${index}`,
      parentId: 'grid',
      order: index,
      layout: { ...root.layout, size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 50 } } },
    }),
  )
  const nodes = makeNodes([root, container, ...children])
  const page = makePage({ id: 'page_1', nodes })
  return { doc: makeDoc({ pages: [page] }), pageId: page.id, containerId: 'grid', childIds: ['c0', 'c1', 'c2'] }
}

/** 取出某个媒体查询块的内容 */
function blockOf(css: string, query: string): string {
  const start = css.indexOf(query)
  if (start < 0) return ''
  const rest = css.slice(start)
  const end = rest.indexOf('\n}', 0)
  return end < 0 ? rest : rest.slice(0, end + 2)
}

/** 从规则里抓某个属性值 */
function declOf(block: string, id: string, prop: string): string {
  const rule = block.split('\n').find((line) => line.includes(`data-id="${id}"`))
  if (!rule) return ''
  const match = new RegExp(`${prop}:\\s*([^;!]+)`).exec(rule)
  return match ? match[1].trim() : ''
}

describe('M3 导出：断点感知的媒体查询', () => {
  it('窄断点各自拿到一个媒体查询块，块里连带页面宽度一起换', () => {
    const { doc, pageId } = scene()
    const css = generateResponsiveCss(doc, pageId)
    expect(css).toContain('@media (max-width: 1199.98px)')
    expect(css).toContain('@media (max-width: 767.98px)')
    const tablet = blockOf(css, '@media (max-width: 1199.98px)')
    expect(tablet).toContain('.page[data-id="root"]')
    expect(declOf(tablet, 'root', 'width')).toBe('768px')
    const mobile = blockOf(css, '@media (max-width: 767.98px)')
    expect(declOf(mobile, 'root', 'width')).toBe('375px')
  })

  it('规则用 !important 压过内联样式', () => {
    const { doc, pageId, childIds } = scene()
    const css = generateResponsiveCss(doc, pageId)
    expect(css).toContain(`.el[data-id="${childIds[0]}"]`)
    expect(css).toContain('!important')
  })

  it('桌面 3 列 → 手机 1 列：手机块里子块变宽，桌面内联样式不变（互不污染）', () => {
    const narrow = scene()
    const wide = scene()
    narrow.doc.pages[0].nodes[narrow.containerId] = {
      ...narrow.doc.pages[0].nodes[narrow.containerId],
      overrides: { mobile: { layout: { columns: 1 } } },
    }
    const css = generateResponsiveCss(narrow.doc, narrow.pageId)
    const mobile = blockOf(css, '@media (max-width: 767.98px)')
    const oneColumn = Number.parseFloat(declOf(mobile, narrow.childIds[0], 'width'))
    // 同一份文档在手机断点没有覆盖时仍是 3 列，子块只有约三分之一宽
    const threeColumnCss = generateResponsiveCss(wide.doc, wide.pageId)
    const threeColumns = Number.parseFloat(
      declOf(blockOf(threeColumnCss, '@media (max-width: 767.98px)'), wide.childIds[0], 'width'),
    )
    expect(oneColumn).toBeGreaterThan(threeColumns * 2)
    // 基准（桌面）几何仍然是 3 列：内联样式与移动覆盖无关
    const baseBoxes = computeLayout({
      nodes: narrow.doc.pages[0].nodes,
      rootId: 'root',
      viewport: { w: 1440, h: 900 },
    }).boxes
    expect(baseBoxes[narrow.childIds[0]].w).toBeCloseTo(460, 5)
    expect(inlineStyle(narrow.doc.pages[0].nodes[narrow.childIds[0]], '', baseBoxes[narrow.childIds[0]])).toContain(
      'width:460px',
    )
  })

  it('hidden 覆盖只在手机块里写 display:none（级联不外溢）', () => {
    const { doc, pageId, childIds } = scene()
    doc.pages[0].nodes[childIds[1]] = { ...doc.pages[0].nodes[childIds[1]], overrides: { mobile: { hidden: true } } }
    const css = generateResponsiveCss(doc, pageId)
    const tablet = blockOf(css, '@media (max-width: 1199.98px)')
    const mobile = blockOf(css, '@media (max-width: 767.98px)')
    expect(declOf(mobile, childIds[1], 'display')).toBe('none')
    expect(declOf(tablet, childIds[1], 'display')).toBe('')
  })

  it('generateHtml 把媒体查询一起写进导出文件', () => {
    const { doc, pageId, childIds } = scene()
    doc.pages[0].nodes[childIds[1]] = { ...doc.pages[0].nodes[childIds[1]], overrides: { mobile: { hidden: true } } }
    const html = generateHtml(doc, pageId)
    expect(html).toContain('@media (max-width: 767.98px)')
    expect(html).toContain('display:none !important')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('只有一个启用断点时没有媒体查询', () => {
    const { doc, pageId } = scene()
    doc.breakpoints = DEFAULT_BREAKPOINTS.map((bp) => ({ ...bp, enabled: bp.id === 'desktop' }))
    expect(generateResponsiveCss(doc, pageId)).toBe('')
  })
})
