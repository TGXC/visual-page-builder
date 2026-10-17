import { describe, expect, it } from 'vitest'
import type { Doc, NodeId, PageId, SceneNode } from '@/core/schema/types'
import { generateCss, generateHtml } from '@/core/codegen'
import { buildSite } from '@/core/site'
import { createZip } from '@/core/zip'
import { makeDoc, makeNode, makeNodes, makePage } from '../unit/factories'

/**
 * M8 性能验收（功能文档 E7）：导出 1000 节点 < 1s。
 *
 * 走的是真实导出路径：`generateCss` + `generateHtml`（单文件）→ `buildSite`（多页站点）
 * → `createZip`（打包）。和布局基准一样先热身、再取 30 次中位数，避免 GC 噪音。
 */

const TOTAL = 1000
const BASE_LAYOUT = makeNode({ id: 'probe' }).layout

/** 1000 节点：10 个区块（vertical + padding/gap），每块 98 个子块（grid 4 列） */
function buildThousandNodePage(): { doc: Doc; pageId: PageId } {
  const rootId = 'root'
  const list: SceneNode[] = [
    makeNode({
      id: rootId,
      type: 'frame',
      layout: {
        ...BASE_LAYOUT,
        mode: 'vertical',
        size: { w: { kind: 'fixed', value: 1440 }, h: { kind: 'fixed', value: 2400 } },
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        gap: 16,
      },
    }),
  ]

  let created = 1
  let sectionOrder = 0
  while (created < TOTAL) {
    const sectionId = `sec_${sectionOrder}`
    list.push(
      makeNode({
        id: sectionId,
        type: 'frame',
        parentId: rootId,
        order: sectionOrder,
        layout: {
          ...BASE_LAYOUT,
          mode: 'grid',
          size: { w: { kind: 'fill' }, h: { kind: 'hug' } },
          columns: 4,
          gap: 12,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
        },
      }),
    )
    created += 1
    let childOrder = 0
    while (childOrder < 98 && created < TOTAL) {
      list.push(
        makeNode({
          id: `el_${sectionOrder}_${childOrder}`,
          type: childOrder % 7 === 0 ? 'text' : 'rect',
          parentId: sectionId,
          order: childOrder,
          props: childOrder % 7 === 0 ? { text: '一段用来触发 hug 估算的文本内容' } : {},
          style: { ...makeNode({ id: 'style-probe' }).style, bg: childOrder % 2 === 0 ? '$color-surface' : '#FFFFFF' },
          layout: {
            ...BASE_LAYOUT,
            mode: 'free',
            size: { w: { kind: 'fill' }, h: { kind: 'hug' } },
          },
        }),
      )
      created += 1
      childOrder += 1
    }
    sectionOrder += 1
  }

  const nodes: Record<NodeId, SceneNode> = makeNodes(list)
  const pageId: PageId = 'page_perf'
  const doc = makeDoc({ pages: [makePage({ id: pageId, root: rootId, nodes })] })
  return { doc, pageId }
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

describe('M8 性能：1000 节点导出', () => {
  it('单页 CSS + HTML + 整站 + ZIP 打包合计中位数 < 1s', () => {
    const { doc, pageId } = buildThousandNodePage()
    expect(Object.keys(doc.pages[0]!.nodes).length).toBe(TOTAL)

    // 热身
    for (let i = 0; i < 3; i += 1) {
      generateCss(doc, pageId)
      generateHtml(doc, pageId)
    }

    const samples: number[] = []
    const stage: Record<string, number[]> = { css: [], html: [], site: [], zip: [] }
    let htmlBytes = 0
    let cssBytes = 0
    let zipBytes = 0
    for (let i = 0; i < 15; i += 1) {
      const started = performance.now()
      let mark = performance.now()
      const css = generateCss(doc, pageId)
      stage.css!.push(performance.now() - mark)
      mark = performance.now()
      const html = generateHtml(doc, pageId)
      stage.html!.push(performance.now() - mark)
      mark = performance.now()
      const files = buildSite(doc)
      stage.site!.push(performance.now() - mark)
      mark = performance.now()
      const zip = createZip(files)
      stage.zip!.push(performance.now() - mark)
      samples.push(performance.now() - started)
      cssBytes = css.length
      htmlBytes = html.length
      zipBytes = zip.length
    }

    const mid = median(samples)
    const min = Math.min(...samples)
    console.log(
      `导出 1000 节点：中位数 ${mid.toFixed(2)}ms，最快 ${min.toFixed(2)}ms，` +
        `CSS ${cssBytes} B / HTML ${htmlBytes} B / ZIP ${zipBytes} B`,
    )
    console.log(
      `  分阶段中位数：CSS ${median(stage.css!).toFixed(2)}ms / HTML ${median(stage.html!).toFixed(2)}ms / ` +
        `整站 ${median(stage.site!).toFixed(2)}ms / ZIP ${median(stage.zip!).toFixed(2)}ms`,
    )

    // 内容确实齐全：每个节点一条 CSS 规则、HTML 里每个节点都有 data-id
    expect((generateCss(doc, pageId).match(/\.n-/g) ?? []).length).toBeGreaterThanOrEqual(TOTAL)
    expect((generateHtml(doc, pageId).match(/data-id=/g) ?? []).length).toBeGreaterThanOrEqual(TOTAL)
    // E7 判据：1000 节点导出 < 1s（本机实测远低于此，留足 CI 抖动余量）
    expect(mid).toBeLessThan(1000)
  })

  it('主题 token 引用在 1000 节点下也走 CSS 变量（导出体积不随 token 数量膨胀）', () => {
    const { doc, pageId } = buildThousandNodePage()
    const css = generateCss(doc, pageId)
    // 节点样式里写的是 $color-surface，导出必须是 var(--color-surface) + :root 定义
    expect(css).toContain('var(--color-surface)')
    expect(css).toContain(':root{')
    expect(css).not.toContain('$color-surface')
  })
})
