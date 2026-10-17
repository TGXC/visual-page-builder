import { describe, expect, it } from 'vitest'
import { createAiService } from '@/ai'
import { componentCatalogText, docOutlineText, draftJsonSchema, instructionJsonSchema } from '@/ai/catalog'
import { MAX_DRAFT_NODES, draftPageId, validateDraft } from '@/ai/draft'
import { createMockProvider, mockDraft } from '@/ai/mock'
import type { AiRequest } from '@/ai/types'
import { makeDoc, makeNode, makePage, makeNodes } from './factories'

/** 最小可生成文档：一页空 frame */
function doc() {
  return makeDoc()
}

function pageRequest(prompt: string): AiRequest {
  const base = doc()
  return { kind: 'page', prompt, context: { doc: base, pageId: base.activePageId } }
}

/** 往草稿里塞一个节点，方便造各种非法输入 */
function withNode(draft: unknown, id: string, node: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(draft)) as { nodes: Record<string, unknown> }
  copy.nodes[id] = node
  return copy
}

describe('Mock provider：一句话生成页面（AI1）', () => {
  it('生成的草稿能过三重校验，并插入为新页面', async () => {
    const provider = createMockProvider()
    const request = pageRequest('做一个读书会落地页')
    const response = await provider.complete(request)
    expect(response.ok).toBe(true)
    expect(response.json).toBeTruthy()

    const result = validateDraft(doc(), response.json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.pages).toHaveLength(2)
    expect(result.doc.activePageId).toBe(result.page.id)
    expect(Object.keys(result.page.nodes).length).toBeGreaterThanOrEqual(6)
    expect(result.page.name.length).toBeGreaterThan(0)
    // 页面上全是真实节点：每一条都是注册表里的类型
    for (const node of Object.values(result.page.nodes)) {
      expect(node.type).toBeTruthy()
      expect(node.parentId === null || result.page.nodes[node.parentId]).toBeTruthy()
    }
  })

  it('Mock 是确定性的：同一 prompt 两次产出逐字节一致', () => {
    const request = pageRequest('做一个读书会落地页')
    expect(JSON.stringify(mockDraft(request))).toBe(JSON.stringify(mockDraft(request)))
  })

  it('草稿的字体与颜色能过对比度检查（生成的内容立刻可用）', async () => {
    const request = pageRequest('做一个读书会落地页')
    const response = await createMockProvider().complete(request)
    const result = validateDraft(doc(), response.json)
    expect(result.ok).toBe(true)
  })
})

describe('PageDraft 三重校验的拒绝路径（失败不落库）', () => {
  const good = mockDraft(pageRequest('做一个读书会落地页'))

  it('第一关：不是对象 / 缺 name / 缺 nodes 都拒绝', () => {
    expect(validateDraft(doc(), null).ok).toBe(false)
    expect(validateDraft(doc(), { root: 'r', nodes: {} }).ok).toBe(false)
    expect(validateDraft(doc(), { name: 'x', root: 'r' }).ok).toBe(false)
  })

  it('第一关：组件类型不在白名单里 → reference 错', () => {
    const bad = withNode(good, 'bad1', { type: 'no-such-type', parentId: 'ai-root', order: 9 })
    const result = validateDraft(doc(), bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((item) => item.code === 'reference' && item.message.includes('no-such-type'))).toBe(true)
  })

  it('第一关：父节点不存在 / 非根没有父节点 → reference 错', () => {
    const missingParent = withNode(good, 'orphan1', { type: 'text', parentId: 'nope', order: 9 })
    expect(validateDraft(doc(), missingParent).ok).toBe(false)
    const noParent = withNode(good, 'orphan2', { type: 'text', parentId: null, order: 9 })
    const result = validateDraft(doc(), noParent)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toContain('没有父节点')
  })

  it('第一关：节点太多直接拒绝', () => {
    const nodes: Record<string, unknown> = { big: { id: 'big', type: 'frame', parentId: null, order: 0 } }
    for (let index = 0; index < MAX_DRAFT_NODES + 5; index += 1) {
      nodes[`n${index}`] = { id: `n${index}`, type: 'text', parentId: 'big', order: index }
    }
    const result = validateDraft(doc(), { name: '大页', root: 'big', nodes })
    expect(result.ok).toBe(false)
  })

  it('第三关：水平越界 → self-check 错（垂直方向允许超长，落地页可以很高）', () => {
    // 自由布局容器里的节点才会按 position 摆放，所以先造一个 free 容器
    const withContainer = withNode(good, 'free1', {
      id: 'free1',
      type: 'container',
      parentId: 'ai-root',
      order: 9,
      layout: {
        mode: 'free',
        size: { w: { kind: 'fixed', value: 1440 }, h: { kind: 'fixed', value: 400 } },
      },
    })
    const overflow = withNode(withContainer, 'wide1', {
      id: 'wide1',
      type: 'rect',
      parentId: 'free1',
      order: 0,
      layout: {
        mode: 'free',
        position: { x: 1300, y: 0 },
        size: { w: { kind: 'fixed', value: 400 }, h: { kind: 'fixed', value: 80 } },
      },
    })
    const result = validateDraft(doc(), overflow)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((item) => item.message.includes('水平越界'))).toBe(true)
  })

  it('必填属性缺失：收敛层的默认值不算数，原始草稿里就得写', () => {
    const noText = withNode(good, 'btn9', { id: 'btn9', type: 'button', parentId: 'ai-root', order: 9 })
    const result = validateDraft(doc(), noText)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((item) => item.message.includes('必填属性 text'))).toBe(true)
  })

  it('拒绝时文档不动：校验只读，返回里没有 doc', () => {
    const start = doc()
    const before = JSON.stringify(start)
    const result = validateDraft(start, { name: 'x' })
    expect(result.ok).toBe(false)
    expect('doc' in result).toBe(false)
    expect(JSON.stringify(start)).toBe(before)
  })
})

describe('页面 id 与提示词素材', () => {
  it('draftPageId 用页面名转 slug，冲突自动加后缀', () => {
    const base = makeDoc()
    const first = draftPageId(base, '读书会落地页')
    expect(first).toContain('读书会落地页')
    const clash = makeDoc({
      pages: [makePage({ id: first, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' })]) })],
    })
    expect(draftPageId(clash, '读书会落地页')).toBe(`${first}_2`)
  })

  it('组件目录来自注册表，页面大纲带 id 与缩进', () => {
    const outline = docOutlineText(doc())
    expect(outline).toContain('页面 首页')
    expect(outline).toContain('id=root')
    const catalog = componentCatalogText()
    expect(catalog).toContain('button')
    expect(catalog).toContain('容器')
  })

  it('两份 JSON Schema 都限定了 op / type 枚举', () => {
    const draftSchema = draftJsonSchema()
    expect(JSON.stringify(draftSchema)).toContain('"required":["name","root","nodes"]')
    const patchSchema = instructionJsonSchema()
    const text = JSON.stringify(patchSchema)
    expect(text).toContain('insert')
    expect(text).toContain('move')
  })
})

describe('AI 服务编排（AI0）', () => {
  it('默认用内置 Mock，不配 key 也能生成页面并记一条调用记录', async () => {
    const service = createAiService()
    expect(service.provider().id).toBe('mock')
    const outcome = await service.generatePage(doc(), '做一个读书会落地页')
    expect(outcome.ok).toBe(true)
    expect(outcome.value?.doc.pages).toHaveLength(2)
    const logs = service.logs()
    expect(logs).toHaveLength(1)
    expect(logs[0].kind).toBe('page')
    expect(logs[0].ok).toBe(true)
    service.clearLogs()
    expect(service.logs()).toHaveLength(0)
  })
})
