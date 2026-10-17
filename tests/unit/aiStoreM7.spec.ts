/**
 * M7 store 接线：文案候选 → 应用 → 可撤销；素材候选 → 应用带来源标记；
 * 生成组件 → 预览 → 注册进「我的组件」；断网降级到规则助手；成本汇总。
 * 对应 PLAN M7 验收：Mock 单测 + 组件测试（候选应用、组件注册、断网降级文案）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editor'
import { getComponent, hasComponent, listComponents, unregisterComponent } from '@/core/components'
import { CUSTOM_DSL_KEY } from '@/core/persistence/custom'
import { PROVIDER_FALLBACK_HINT } from '@/ai/offline'

function setup() {
  setActivePinia(createPinia())
  return useEditorStore()
}

/** 注册表是模块级的，测试之间必须清掉自定义组件 */
function clearCustom(): void {
  for (const descriptor of listComponents()) {
    if (descriptor.category === 'custom') unregisterComponent(descriptor.type)
  }
}

beforeEach(() => {
  localStorage.clear()
  clearCustom()
})

afterEach(() => {
  clearCustom()
})

describe('M7 store：文案候选与素材候选（AI4）', () => {
  it('生成 3 个文案候选 → 应用其一 → 只改选中节点 → 可撤销', async () => {
    const store = setup()
    store.newProject()
    store.insertComponent('text')
    const target = store.selectedIds[0]
    const othersBefore = store.topLevel.filter((node) => node.id !== target).map((node) => JSON.stringify(node))
    const before = store.nodes[target].props.text

    expect(await store.aiTextOptions('读书会活动')).toBe(true)
    expect(store.aiTextCandidates).toHaveLength(3)
    expect(store.aiDegraded).toBe('')
    expect(store.labels.length).toBe(store.position + 1)

    expect(store.aiApplyText(1)).toBe(true)
    expect(store.nodes[target].props.text).not.toBe(before)
    expect(store.nodes[target].props.text).toBe(store.aiTextCandidates[1].text)
    expect(store.labels.at(-1)).toMatch(/^AI 文案：/)
    expect(store.topLevel.filter((node) => node.id !== target).map((node) => JSON.stringify(node))).toEqual(othersBefore)

    store.undo()
    expect(store.nodes[target].props.text).toBe(before)
  })

  it('空提示词不给候选；没选中元素时应用会被拦住', async () => {
    const store = setup()
    store.newProject()
    expect(await store.aiTextOptions('   ')).toBe(false)
    expect(store.aiTextCandidates).toHaveLength(0)
    store.clearSelection()
    expect(store.aiApplyText(0)).toBe(false)
  })

  it('素材候选写 props.src + 来源标记并补 alt，可撤销', async () => {
    const store = setup()
    store.newProject()
    store.insertComponent('image')
    const target = store.selectedIds[0]
    expect(await store.aiMaterialOptions('夏日读书会配图')).toBe(true)
    expect(store.aiMaterialCandidates).toHaveLength(3)
    expect(store.aiApplyMaterial(0, '夏日读书会')).toBe(true)
    const node = store.nodes[target]
    expect(String(node.props.src).startsWith('data:image/png;base64,')).toBe(true)
    expect(node.props.source).toBe('generated')
    expect(node.props.alt).toBe('夏日读书会')
    expect(store.labels.at(-1)).toBe('AI 素材：应用配图')

    store.undo()
    expect(store.nodes[target].props.src).toBeUndefined()
  })
})

describe('M7 store：生成并注册自定义组件（AI5）', () => {
  it('生成候选 → 注册进「我的组件」→ 写本机存档 → 可插入画布', async () => {
    const store = setup()
    store.newProject()
    expect(await store.aiComponentOption('一个带头像和在线状态点的团队成员卡片')).toBe(true)
    const candidate = store.aiComponentCandidate
    expect(candidate).not.toBeNull()
    expect(candidate?.dsl.name).toContain('团队成员')
    expect(candidate?.previewHtml).toContain('cc-')

    expect(store.aiRegisterComponent()).toBe(true)
    const type = candidate?.dsl.name ? store.aiCustomTypes[0] : ''
    expect(type).toMatch(/^custom-/)
    expect(hasComponent(type)).toBe(true)
    expect(getComponent(type)?.category).toBe('custom')
    expect(localStorage.getItem(CUSTOM_DSL_KEY)).toContain(candidate?.dsl.name as string)

    store.insertComponent(type)
    const inserted = store.nodes[store.selectedIds[0]]
    expect(inserted.type).toBe(type)

    unregisterComponent(type)
    store.undo()
  })

  it('新会话启动时自动恢复本机存档的自定义组件', async () => {
    const first = setup()
    first.newProject()
    await first.aiComponentOption('价格套餐卡片')
    first.aiRegisterComponent()
    const type = first.aiCustomTypes[0]
    expect(hasComponent(type)).toBe(true)

    // 模拟「重新打开页面」：注册表清空，store 重新创建时从存档装回来
    unregisterComponent(type)
    expect(hasComponent(type)).toBe(false)
    const second = setup()
    void second
    expect(hasComponent(type)).toBe(true)
    expect(second.aiCustomTypes).toContain(type)
    unregisterComponent(type)
  })

  it('空描述不生成，注册前没有候选时返回 false', async () => {
    const store = setup()
    store.newProject()
    expect(await store.aiComponentOption('  ')).toBe(false)
    expect(store.aiRegisterComponent()).toBe(false)
  })
})

describe('M7 store：断网降级与成本面板（AI6）', () => {
  it('供应商不可用时自动降级到规则助手，失败也记进调用记录', async () => {
    const store = setup()
    store.newProject()
    store.aiSaveSettings({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })
    store.aiSetProvider('openai')
    expect(await store.aiTextOptions('读书会')).toBe(true)
    expect(store.aiTextCandidates).toHaveLength(3)
    expect(store.aiDegraded).toBe(PROVIDER_FALLBACK_HINT)
    expect(store.aiDegraded).toContain('规则助手')
    expect(store.aiLogs.at(-1)?.ok).toBe(false)
    expect(store.aiLogs.at(-1)?.error).toContain('还没配置好')
  })

  it('成本汇总跟着调用记录走', async () => {
    const store = setup()
    store.newProject()
    await store.aiTextOptions('读书会')
    expect(store.aiUsage.calls).toBe(1)
    expect(store.aiUsage.tokens).toBeGreaterThan(0)
    store.aiClearLogs()
    expect(store.aiUsage.calls).toBe(0)
    expect(store.aiUsage.tokens).toBe(0)
  })
})
