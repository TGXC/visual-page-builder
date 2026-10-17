/**
 * M7 组件测试：AI 面板新区的「候选应用 / 组件注册 / 降级文案」。
 * 挂载范式照抄 tests/component/output.spec.ts（真 pinia + 真 store + EditorShell）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditorShell from '@/components/editor/EditorShell.vue'
import { useEditorStore } from '@/stores/editor'
import { listComponents, unregisterComponent } from '@/core/components'
import { installLayout } from './helpers'

let wrapper: VueWrapper | undefined

function mountShell() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useEditorStore()
  store.newProject()
  wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  return store
}

async function flush(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function clearCustom(): void {
  for (const descriptor of listComponents()) {
    if (descriptor.category === 'custom') unregisterComponent(descriptor.type)
  }
}

beforeEach(() => {
  localStorage.clear()
  clearCustom()
  installLayout()
  vi.useFakeTimers()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  clearCustom()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('M7 AI 面板：文案 / 素材 / 生成组件 / 成本 / 降级', () => {
  it('文案候选显示在面板上，点一条就应用到选中节点且可撤销', async () => {
    const store = mountShell()
    store.insertComponent('text')
    const target = store.selectedIds[0]
    const othersBefore = store.topLevel
      .filter((node) => node.id !== target)
      .map((node) => JSON.stringify(node))

    await wrapper?.find('[data-role="ai-text-prompt"]').setValue('读书会报名标题')
    await wrapper?.find('[data-role="ai-text-generate"]').trigger('click')
    await flush()

    const buttons = wrapper?.findAll('[data-role="ai-text-candidate"]') ?? []
    expect(buttons).toHaveLength(3)
    await buttons[1].trigger('click')
    await flush()

    expect(store.nodes[target].props.text).not.toBe('')
    expect(store.labels.at(-1)).toMatch(/^AI 文案：/)
    expect(
      store.topLevel
        .filter((node) => node.id !== target)
        .map((node) => JSON.stringify(node)),
    ).toEqual(othersBefore)
    store.undo()
    await flush()
    expect(wrapper?.findAll('[data-role="ai-text-candidate"]').length).toBe(3)
  })

  it('素材候选渲染成缩略图，点一张写进选中图片的 props.source', async () => {
    const store = mountShell()
    store.insertComponent('image')
    const target = store.selectedIds[0]

    await wrapper?.find('[data-role="ai-material-prompt"]').setValue('夏日读书会配图')
    await wrapper?.find('[data-role="ai-material-generate"]').trigger('click')
    await flush()

    const items = wrapper?.findAll('[data-role="ai-material"]') ?? []
    expect(items).toHaveLength(3)
    expect(items[0].find('img').attributes('src')).toContain('data:image/png;base64,')
    await items[0].trigger('click')
    await flush()

    expect(store.nodes[target].props.src).toContain('data:image/png;base64,')
    expect(store.nodes[target].props.source).toBe('generated')
    expect(store.labels.at(-1)).toBe('AI 素材：应用配图')
    store.undo()
    await flush()
    expect(store.nodes[target].props.src ?? '').toBe('')
  })

  it('生成组件先出预览，点注册才进「我的组件」并可插入画布', async () => {
    const store = mountShell()
    expect(wrapper?.find('[data-role="ai-component-preview"]').exists()).toBe(false)

    await wrapper?.find('[data-role="ai-component-prompt"]').setValue('一个团队成员卡片')
    await wrapper?.find('[data-role="ai-component-generate"]').trigger('click')
    await flush()

    const preview = wrapper?.find('[data-role="ai-component-preview"]')
    expect(preview?.exists()).toBe(true)
    expect(preview?.attributes('srcdoc')).toContain('cc-')
    expect(store.aiCustomTypes).toHaveLength(0)

    await wrapper?.find('[data-role="ai-component-register"]').trigger('click')
    await flush()
    expect(store.aiCustomTypes).toHaveLength(1)
    expect(store.aiCustomTypes[0]).toMatch(/^custom-/)
    expect(wrapper?.find('[data-role="ai-custom-types"]').text()).toContain('1 个')
    // 注册后组件面板出现「我的组件」分组（空分组平时不显示）
    expect(wrapper?.find('.palette-group[data-category="custom"]').exists()).toBe(true)

    const type = store.aiCustomTypes[0]
    store.insertComponent(type)
    await flush()
    expect(store.selectedIds).toHaveLength(1)
    expect(store.nodes[store.selectedIds[0]].type).toBe(type)
  })

  it('面板显示调用次数 / token / 成本，清空后归零', async () => {
    const store = mountShell()
    expect(wrapper?.find('[data-role="ai-usage"]').text()).toContain('0 次调用')

    await wrapper?.find('[data-role="ai-text-prompt"]').setValue('副标题')
    await wrapper?.find('[data-role="ai-text-generate"]').trigger('click')
    await flush()

    const usage = wrapper?.find('[data-role="ai-usage"]').text() ?? ''
    expect(usage).toContain('1 次调用')
    expect(store.aiUsage.tokens).toBeGreaterThan(0)

    await wrapper?.find('[data-role="ai-logs-toggle"]').trigger('click')
    await wrapper?.find('[data-role="ai-logs-clear"]').trigger('click')
    await flush()
    expect(wrapper?.find('[data-role="ai-usage"]').text()).toContain('0 次调用')
  })

  it('供应商不可用时面板给出降级文案，规则助手照样出候选', async () => {
    const store = mountShell()
    store.aiSaveSettings({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })
    store.aiSetProvider('openai')
    await flush()

    await wrapper?.find('[data-role="ai-text-prompt"]').setValue('报名按钮')
    await wrapper?.find('[data-role="ai-text-generate"]').trigger('click')
    await flush()

    const degraded = wrapper?.find('[data-role="ai-degraded"]')
    expect(degraded?.exists()).toBe(true)
    expect(degraded?.text()).toContain('规则助手')
    expect(wrapper?.findAll('[data-role="ai-text-candidate"]')).toHaveLength(3)
  })
})
