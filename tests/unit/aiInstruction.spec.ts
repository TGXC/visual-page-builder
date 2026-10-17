import { describe, expect, it } from 'vitest'
import { createAiService } from '@/ai'
import { applyInstruction, coercePatches, scopeProblems } from '@/ai/instruction'
import { createMockProvider, mockInstruction } from '@/ai/mock'
import type { AiProvider, AiResponse } from '@/ai/types'
import type { Doc, SceneNode } from '@/core/schema/types'
import { makeDoc, makeNode, makeNodes, makePage, snapshot } from './factories'

const ROOT_LAYOUT = {
  mode: 'vertical' as const,
  position: { x: 0, y: 0 },
  size: { w: { kind: 'fixed' as const, value: 1440 }, h: { kind: 'fixed' as const, value: 900 } },
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: 16,
  columns: 1,
  align: 'start' as const,
  justify: 'start' as const,
  wrap: false,
  constraints: { h: 'left' as const, v: 'top' as const },
}

function fixture(): Doc {
  const root = makeNode({ id: 'root', type: 'frame', layout: ROOT_LAYOUT })
  const sec = makeNode({ id: 'sec1', type: 'section', parentId: 'root', order: 0, layout: { ...ROOT_LAYOUT, size: { w: { kind: 'fill' as const }, h: { kind: 'fixed' as const, value: 300 } } } })
  const txt = makeNode({ id: 'txt1', type: 'text', parentId: 'sec1', order: 0, props: { text: '原始文案' } })
  const btn = makeNode({ id: 'btn1', type: 'button', parentId: 'root', order: 1, props: { text: '点我' } })
  const other = makeNode({ id: 'other1', type: 'text', parentId: 'root', order: 2, props: { text: '别动我' } })
  return makeDoc({ pages: [makePage({ id: 'page_1', root: 'root', nodes: makeNodes([root, sec, txt, btn, other]) })] })
}

function instructionRequest(selectionIds: string[], prompt: string) {
  const base = fixture()
  return { kind: 'instruction' as const, prompt, context: { doc: base, pageId: 'page_1', selectionIds } }
}

describe('选区指令：只影响选中子树（AI2 验收）', () => {
  it('Mock 把「改成某文案」变成 update 补丁，未选中节点 JSON 不变', () => {
    const base = fixture()
    const request = instructionRequest(['btn1'], '把文案改成「立即预约」')
    const raw = mockInstruction(request)
    const applied = applyInstruction(base, 'page_1', raw, ['btn1'])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.patches).toHaveLength(1)
    expect(applied.patches[0].op).toBe('update')

    const page = applied.doc.pages[0]
    expect(page.nodes.btn1.props.text).toBe('立即预约')
    // 未选中的节点逐字节不变
    expect(snapshot(page.nodes.other1)).toBe(snapshot(base.pages[0].nodes.other1))
    expect(snapshot(page.nodes.txt1)).toBe(snapshot(base.pages[0].nodes.txt1))
    expect(snapshot(applied.doc.pages[0].viewport)).toBe(snapshot(base.pages[0].viewport))
    expect(applyInstruction(base, 'page_1', raw, ['btn1']).ok).toBe(true)
  })

  it('选中容器时补丁只落在它的子孙上；越界引用被拒绝且文档不变', () => {
    const base = fixture()
    const inside = mockInstruction(instructionRequest(['sec1'], '把文案改成「新标题」'))
    const appliedInside = applyInstruction(base, 'page_1', inside, ['sec1'])
    expect(appliedInside.ok).toBe(true)
    if (appliedInside.ok) {
      expect(appliedInside.doc.pages[0].nodes.txt1.props.text).toBe('新标题')
      expect(snapshot(appliedInside.doc.pages[0].nodes.btn1)).toBe(snapshot(base.pages[0].nodes.btn1))
    }

    // 模型想改选区外的 other1 → scope 错，文档原样
    const before = snapshot(base)
    const escape = { patches: [{ op: 'update', id: 'other1', after: { props: { text: '偷偷改' } } }] }
    const rejected = applyInstruction(base, 'page_1', escape, ['btn1'])
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.errors[0].code).toBe('scope')
      expect(rejected.errors[0].message).toContain('不在选区')
    }
    expect(snapshot(base)).toBe(before)
  })

  it('模型的 before 一律不采信：patch.before 从当前文档现取（撤销才对）', () => {
    const base = fixture()
    const raw = {
      patches: [{ op: 'update', id: 'btn1', before: { props: { text: '模型瞎写的' } }, after: { props: { text: '真文案' } } }],
    }
    const coerced = coercePatches(base, 'page_1', raw)
    expect(coerced.errors).toHaveLength(0)
    expect(coerced.patches[0]).toMatchObject({ op: 'update', id: 'btn1' })
    const patch = coerced.patches[0]
    if (patch.op === 'update') {
      expect(patch.before.props).toEqual({ text: '点我' })
      expect(patch.after.props).toEqual({ text: '真文案' })
    }
  })

  it('样式只给差异时补成完整对象（applyPatch 是整体替换）', () => {
    const base = fixture()
    const raw = { patches: [{ op: 'update', id: 'btn1', after: { style: { bg: '#E5484D' } } }] }
    const coerced = coercePatches(base, 'page_1', raw)
    const patch = coerced.patches[0]
    expect(patch.op).toBe('update')
    if (patch.op !== 'update') return
    const style = patch.after.style as SceneNode['style']
    const current = base.pages[0].nodes.btn1.style
    expect(style.bg).toBe('#E5484D')
    expect(style.color).toBe(current.color)
    expect(Object.keys(style).sort()).toEqual(Object.keys(current).sort())
  })
})

describe('选区指令的拒绝路径', () => {
  it('没选中元素 → scope 错', () => {
    const base = fixture()
    const result = applyInstruction(base, 'page_1', { patches: [] }, [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].code).toBe('scope')
  })

  it('不给补丁 / 不给 patches 数组 → shape 错', () => {
    const base = fixture()
    expect(applyInstruction(base, 'page_1', { patches: [] }, ['btn1']).ok).toBe(false)
    expect(applyInstruction(base, 'page_1', { nope: 1 }, ['btn1']).ok).toBe(false)
    expect(applyInstruction(base, 'page_1', 'x', ['btn1']).ok).toBe(false)
  })

  it('未注册组件类型 / 父节点不是容器 / 删除根节点都拒绝', () => {
    const base = fixture()
    const unknownType = applyInstruction(base, 'page_1', { patches: [{ op: 'insert', node: { type: 'no-such', parentId: 'root' } }] }, ['root'])
    expect(unknownType.ok).toBe(false)
    if (!unknownType.ok) expect(unknownType.errors[0].code).toBe('reference')

    const notContainer = applyInstruction(base, 'page_1', { patches: [{ op: 'insert', node: { type: 'text', parentId: 'btn1' } }] }, ['btn1'])
    expect(notContainer.ok).toBe(false)

    const removeRoot = applyInstruction(base, 'page_1', { patches: [{ op: 'remove', id: 'root' }] }, ['root'])
    expect(removeRoot.ok).toBe(false)
  })

  it('insert 合法时落到容器末尾，order 连续', () => {
    const base = fixture()
    const raw = { patches: [{ op: 'insert', node: { type: 'text', parentId: 'sec1', props: { text: '新增' } } }] }
    const applied = applyInstruction(base, 'page_1', raw, ['sec1'])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const page = applied.doc.pages[0]
    const texts = Object.values(page.nodes).filter((node) => node.parentId === 'sec1')
    expect(texts).toHaveLength(2)
    expect(texts.map((node) => node.order).sort()).toEqual([0, 1])
    expect(scopeProblems(base, 'page_1', applied.patches, ['sec1'])).toHaveLength(0)
  })

  it('补丁指向别的页面 → scope 错', () => {
    const base = fixture()
    const patch = { op: 'update' as const, pageId: 'page_other', id: 'btn1', before: {}, after: { props: { text: 'x' } } }
    const problems = scopeProblems(base, 'page_1', [patch], ['btn1'])
    expect(problems[0].code).toBe('scope')
  })
})

describe('AI 服务：重试一次、失败不落库、调用记录', () => {
  it('Mock 走服务能落库并记录一条「AI 编辑」', async () => {
    const service = createAiService()
    const outcome = await service.editSelection(fixture(), 'page_1', ['btn1'], '把文案改成「立即预约」')
    expect(outcome.ok).toBe(true)
    expect(outcome.value?.patches).toHaveLength(1)
    expect(outcome.value?.doc.pages[0].nodes.btn1.props.text).toBe('立即预约')
    expect(service.logs()[0].kind).toBe('instruction')
    expect(service.logs()[0].summary).toContain('改动 1 处')
  })

  it('第一次输出不合法会自动重试一次，第二次成功', async () => {
    const base = fixture()
    let calls = 0
    const stub: AiProvider = {
      id: 'stub',
      label: '假供应商',
      ready: true,
      async complete(): Promise<AiResponse> {
        calls += 1
        if (calls === 1) return { ok: true, json: { nodes: {} }, provider: 'stub', ms: 1 }
        return { ok: true, json: mockInstruction(instructionRequest(['btn1'], '把文案改成「第二次」')), provider: 'stub', ms: 2 }
      },
    }
    const service = createAiService(stub)
    const outcome = await service.editSelection(base, 'page_1', ['btn1'], '把文案改成「第二次」')
    expect(calls).toBe(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.value?.doc.pages[0].nodes.btn1.props.text).toBe('第二次')
  })

  it('一直不合法：报错、不落库、记录 ok=false', async () => {
    const base = fixture()
    const before = snapshot(base)
    let calls = 0
    const stub: AiProvider = {
      id: 'stub',
      label: '假供应商',
      ready: true,
      async complete(): Promise<AiResponse> {
        calls += 1
        return { ok: true, json: { patches: [{ op: 'update', id: 'other1', after: { props: { text: '越界' } } }] }, provider: 'stub', ms: 1 }
      },
    }
    const service = createAiService(stub)
    const outcome = await service.editSelection(base, 'page_1', ['btn1'], '随便改')
    expect(calls).toBe(2)
    expect(outcome.ok).toBe(false)
    expect(outcome.value).toBeUndefined()
    expect(outcome.errors[0].code).toBe('scope')
    expect(snapshot(base)).toBe(before)
    const pageOutcome = await service.generatePage(base, '随便生成')
    expect(pageOutcome.ok).toBe(false)
    expect(service.logs().every((entry) => entry.ok === false)).toBe(true)
    expect(service.logs()[0].error).toBeTruthy()
  })

  it('供应商直接失败 / 没配好：provider 错，且不会调用 provider', async () => {
    const failing: AiProvider = {
      id: 'bad',
      label: '坏供应商',
      ready: true,
      async complete(): Promise<AiResponse> {
        return { ok: false, error: '401 Unauthorized', provider: 'bad', ms: 3 }
      },
    }
    const service = createAiService(failing)
    const outcome = await service.editSelection(fixture(), 'page_1', ['btn1'], '改文案')
    expect(outcome.ok).toBe(false)
    expect(outcome.errors[0].code).toBe('provider')
    expect(outcome.errors[0].message).toContain('401')

    let called = 0
    const unready: AiProvider = {
      id: 'nokey',
      label: '未配置',
      ready: false,
      async complete(): Promise<AiResponse> {
        called += 1
        return { ok: true, json: {}, provider: 'nokey', ms: 0 }
      },
    }
    const other = createAiService(unready)
    const blocked = await other.generatePage(fixture(), '生成')
    expect(blocked.ok).toBe(false)
    expect(blocked.errors[0].code).toBe('provider')
    expect(called).toBe(0)
  })

  it('切换供应商：setProvider 之后 provider() 返回新的', () => {
    const service = createAiService()
    const replacement = createMockProvider({ id: 'mock-2', label: '第二个假供应商' })
    service.setProvider(replacement)
    expect(service.provider().id).toBe('mock-2')
  })
})

describe('Mock provider 的输入检查', () => {
  it('选区指令没选区时直接报错，不调模型', async () => {
    const base = fixture()
    const response = await createMockProvider().complete({ kind: 'instruction', prompt: '改一下', context: { doc: base, pageId: 'page_1', selectionIds: [] } })
    expect(response.ok).toBe(false)
    expect(response.error).toContain('先选中')
  })

  it('纯文本请求返回 text', async () => {
    const response = await createMockProvider().complete({ kind: 'text', prompt: '给读书会写一句标语' })
    expect(response.ok).toBe(true)
    expect(typeof response.text).toBe('string')
  })
})
