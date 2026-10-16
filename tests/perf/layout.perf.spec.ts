import { describe, expect, it } from 'vitest'
import type { NodeId, SceneNode } from '@/core/schema/types'
import { computeLayout } from '@/core/layout'
import { makeNode, makeNodes } from '../unit/factories'

/**
 * M2 性能验收：1000 节点整树 computeLayout < 8ms。
 *
 * 计时方式：先热身 20 次（让 V8 把布局代码 JIT 到稳定态），再取 30 次的中位数。
 * 用中位数而不是平均值，是因为一次偶发的 GC 就能把平均值拉高，判据会变成噪音。
 */

const TOTAL = 1000
/** 每个节点共用同一份 layout 底稿，只有真正要改的字段被覆盖 */
const BASE_LAYOUT = makeNode({ id: 'probe' }).layout

/** 1000 节点：10 个区块（vertical + padding/gap），每块 98 个子块（4 列 grid），加根 frame */
function buildThousandNodePage(): { nodes: Record<NodeId, SceneNode>; rootId: NodeId } {
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
      const ratio = childOrder % 5 === 0
      list.push(
        makeNode({
          id: `el_${sectionOrder}_${childOrder}`,
          type: childOrder % 7 === 0 ? 'text' : 'rect',
          parentId: sectionId,
          order: childOrder,
          props: childOrder % 7 === 0 ? { text: '一段用来触发 hug 估算的文本内容' } : {},
          layout: {
            ...BASE_LAYOUT,
            mode: 'free',
            size: ratio
              ? { w: { kind: 'ratio', value: 16 / 9 }, h: { kind: 'ratio', value: 16 / 9 } }
              : { w: { kind: 'fill' }, h: { kind: 'hug' } },
          },
        }),
      )
      created += 1
      childOrder += 1
    }
    sectionOrder += 1
  }

  return { nodes: makeNodes(list), rootId }
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

describe('M2 性能：1000 节点整树布局', () => {
  it('1000 节点 computeLayout 中位数 < 8ms', () => {
    const { nodes, rootId } = buildThousandNodePage()
    expect(Object.keys(nodes).length).toBe(TOTAL)

    const input = { nodes, rootId, viewport: { w: 1440, h: 2400 } }

    for (let i = 0; i < 20; i += 1) computeLayout(input)

    const samples: number[] = []
    let boxCount = 0
    for (let i = 0; i < 30; i += 1) {
      const started = performance.now()
      const result = computeLayout(input)
      samples.push(performance.now() - started)
      boxCount = Object.keys(result.boxes).length
    }

    const mid = median(samples)
    const min = Math.min(...samples)
    // 打印出来，验收时能直接看到真实数字
    console.log(
      `computeLayout 1000 节点：中位数 ${mid.toFixed(2)}ms，最快 ${min.toFixed(2)}ms，产出 ${boxCount} 个盒子`,
    )

    expect(boxCount).toBe(TOTAL)
    expect(mid).toBeLessThan(8)
  })
})
