/**
 * M6 验收：AI 接线到 store 的行为。
 * 重点：离线（Mock）可用；AI 操作可撤销；失败不污染文档；选区指令只动选中子树。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editor'

function setup() {
  setActivePinia(createPinia())
  return useEditorStore()
}

describe('M6 AI 接线（store）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认离线可用：Mock 供应商 ready，检查项随文档实时重算', () => {
    const store = setup()
    expect(store.aiProviderId).toBe('mock')
    expect(store.aiProviders.find((item) => item.id === 'mock')?.ready).toBe(true)
    expect(store.aiProviders.find((item) => item.id === 'openai')?.ready).toBe(false)
    expect(Array.isArray(store.aiIssues)).toBe(true)
    expect(store.aiLogs).toEqual([])
  })

  it('AI1 生成页面：插入真实页面 + 一条可撤销的文档级历史', async () => {
    const store = setup()
    const pagesBefore = store.pages.length
    const initialPageId = store.activePage.id
    const ok = await store.aiGeneratePage('做一个读书会落地页')
    expect(ok).toBe(true)
    expect(store.pages.length).toBe(pagesBefore + 1)
    expect(store.activePage.name).toContain('读书会')
    expect(store.labels.at(-1)).toMatch(/^AI 生成页面：/)
    expect(store.doc.pages.at(-1)?.nodes[store.doc.pages.at(-1)!.root]).toBeTruthy()
    expect(store.aiLogs.length).toBe(1)

    store.undo()
    expect(store.pages.length).toBe(pagesBefore)
    expect(store.activePage.id).toBe(initialPageId)

    store.redo()
    expect(store.pages.length).toBe(pagesBefore + 1)
  })

  it('AI1 失败不落库：空提示词、供应商没配好都不改文档', async () => {
    const store = setup()
    const before = JSON.stringify(store.doc)
    expect(await store.aiGeneratePage('   ')).toBe(false)
    expect(JSON.stringify(store.doc)).toBe(before)

    store.aiSetProvider('openai')
    expect(store.aiProviders.find((item) => item.id === 'openai')?.ready).toBe(false)
    const labelsBefore = store.labels.length
    expect(await store.aiGeneratePage('做一个落地页')).toBe(false)
    expect(JSON.stringify(store.doc)).toBe(before)
    expect(store.labels.length).toBe(labelsBefore)
  })

  it('AI2 选区指令：只改选中节点，未选中节点逐字节不变', async () => {
    const store = setup()
    const target = store.insertComponent('text')
    const other = store.insertComponent('heading')
    store.select(target)
    expect(store.nodes[target].props.text).toBeTruthy()

    const othersBefore = store.topLevel
      .filter((node) => node.id !== target)
      .map((node) => JSON.stringify(node))
    const untouchedBefore = JSON.stringify(store.nodes[other])
    const viewportBefore = JSON.stringify(store.activePage.viewport)

    const ok = await store.aiEditSelection('把文案改成「立即预约」')
    expect(ok).toBe(true)
    expect(store.nodes[target].props.text).toBe('立即预约')
    expect(store.labels.at(-1)).toMatch(/^AI 编辑：/)
    expect(JSON.stringify(store.nodes[other])).toBe(untouchedBefore)
    expect(
      store.topLevel.filter((node) => node.id !== target).map((node) => JSON.stringify(node)),
    ).toEqual(othersBefore)
    expect(JSON.stringify(store.activePage.viewport)).toBe(viewportBefore)

    store.undo()
    expect(store.nodes[target].props.text).not.toBe('立即预约')
  })

  it('AI2 空选区 / 空指令直接拒绝，不动历史', async () => {
    const store = setup()
    store.clearSelection()
    const labelsBefore = store.labels.length
    expect(await store.aiEditSelection('改成红色')).toBe(false)
    expect(await store.aiEditSelection('   ')).toBe(false)
    expect(store.labels.length).toBe(labelsBefore)
  })

  it('AI3 规则检查：单条修复与一键修复都进历史且能撤销回原样', () => {
    const store = setup()
    const text = store.insertComponent('text')
    // 浅灰字压白底：必然触发对比度检查（WCAG AA）
    store.updateNode(text, { style: { color: '#F5F5F5' } })
    const before = store.aiIssues.map((issue) => issue.id)
    expect(before.some((id) => id.startsWith('contrast:'))).toBe(true)

    const contrast = store.aiIssues.find((issue) => issue.kind === 'contrast')
    expect(contrast).toBeTruthy()
    expect(store.aiFixIssue(contrast!.id)).toBe(true)
    expect(store.labels.at(-1)).toMatch(/^AI 修复：/)
    expect(store.aiIssues.some((issue) => issue.kind === 'contrast')).toBe(false)

    store.undo()
    expect(store.aiIssues.map((issue) => issue.id)).toEqual(before)

    const fixed = store.aiFixAll()
    expect(fixed).toBeGreaterThan(0)
    expect(store.labels.at(-1)).toBe('AI 一键修复')
    expect(store.aiIssues.length).toBeLessThan(before.length)
    expect(store.aiIssues.some((issue) => issue.patches.length > 0)).toBe(false)

    store.undo()
    expect(store.aiIssues.map((issue) => issue.id)).toEqual(before)
  })

  it('AI6：设置只写本机 localStorage，记录可清空', () => {
    const store = setup()
    store.aiSaveSettings({ apiKey: 'sk-local-only', model: 'my-model' })
    expect(store.aiProviders.find((item) => item.id === 'openai')?.ready).toBe(true)
    expect(store.aiSettings.model).toBe('my-model')
    const raw = localStorage.getItem('studio.ai.settings.v1') ?? ''
    expect(raw).toContain('sk-local-only')
    expect(JSON.stringify(store.doc)).not.toContain('sk-local-only')

    store.aiSetProvider('openai')
    expect(store.aiProviderId).toBe('openai')
    store.aiSetProvider('mock')
    store.aiClearLogs()
    expect(store.aiLogs).toEqual([])
    store.aiSaveSettings({ apiKey: '' })
  })
})
