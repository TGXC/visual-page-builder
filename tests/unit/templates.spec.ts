import { describe, expect, it } from 'vitest'
import { TEMPLATES, createFromTemplate } from '@/core/templates'
import { generateHtml } from '@/core/codegen'
import { canonicalNodes, childrenOf } from '@/core/tree'
import { normalizeDoc } from '@/core/schema/normalize'

describe('templates：模板库', () => {
  it('M1 从 3 套升级到 6 套，id 与标签都不重复', () => {
    expect(TEMPLATES).toHaveLength(6)
    expect(new Set(TEMPLATES.map((item) => item.id)).size).toBe(6)
    expect(new Set(TEMPLATES.map((item) => item.label)).size).toBe(6)
    expect(TEMPLATES.map((item) => item.id)).toEqual(['login', 'landing', 'profile', 'pricing', 'about', 'blog'])
  })

  it('未知 id 返回 null', () => {
    expect(createFromTemplate('nope')).toBeNull()
  })

  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    '%s：结构合法（唯一根、id 不重复、顺序连续、可渲染）',
    (_id, template) => {
      const doc = template.create()
      const page = doc.pages[0]
      const nodes = page.nodes
      const ids = Object.keys(nodes)

      // 唯一根
      const roots = Object.values(nodes).filter((node) => node.parentId === null)
      expect(roots).toHaveLength(1)
      expect(roots[0].id).toBe(page.root)
      expect(roots[0].type).toBe('frame')

      // id 不重复 + 有内容
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeGreaterThanOrEqual(5)

      // 每个非根节点都挂在一个存在的父级上
      for (const node of Object.values(nodes)) {
        if (node.id === page.root) continue
        expect(nodes[node.parentId as string]).toBeDefined()
      }

      // 同级 order 连续
      const parents = new Set(Object.values(nodes).map((node) => node.parentId))
      for (const parentId of parents) {
        const orders = childrenOf(nodes, parentId).map((node) => node.order)
        expect(orders).toEqual(orders.map((_value, index) => index))
      }

      // 顺序与规范化一致（同一逻辑状态 → 同一份 JSON）
      expect(Object.keys(canonicalNodes(nodes))).toEqual(ids)

      // 导出 HTML 可用
      const html = generateHtml(doc, page.id)
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('[object Object]')
    },
  )

  it('模板文档能通过收敛层且不丢节点', () => {
    for (const template of TEMPLATES) {
      const doc = template.create()
      const normalized = normalizeDoc(JSON.parse(JSON.stringify(doc)))
      expect(normalized).not.toBeNull()
      expect(Object.keys(normalized?.pages[0].nodes ?? {})).toHaveLength(Object.keys(doc.pages[0].nodes).length)
    }
  })

  it('模板落在桌面基准画布内（不外溢）', () => {
    for (const template of TEMPLATES) {
      const doc = template.create()
      const page = doc.pages[0]
      for (const node of Object.values(page.nodes)) {
        if (node.id === page.root) continue
        expect(node.layout.position.x).toBeGreaterThanOrEqual(0)
        expect(node.layout.position.y).toBeGreaterThanOrEqual(0)
        expect(node.layout.position.x + (node.layout.size.w.value ?? 0)).toBeLessThanOrEqual(page.viewport.w + 1)
        expect(node.layout.position.y + (node.layout.size.h.value ?? 0)).toBeLessThanOrEqual(page.viewport.h + 1)
      }
    }
  })
})
