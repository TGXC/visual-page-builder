import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import type { EditorStore } from '@/stores/editor'
import { useEditorStore } from '@/stores/editor'
import { installLayout } from './helpers'

function mountShell(): { wrapper: VueWrapper; store: EditorStore } {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useEditorStore()
  store.newProject()
  const wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, store }
}

async function flush(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('M6 AI 面板：供应商、生成、选区指令与规则修复', () => {
  let wrapper: VueWrapper
  let store: EditorStore

  beforeEach(() => {
    localStorage.clear()
    installLayout()
    vi.useFakeTimers()
    const mounted = mountShell()
    wrapper = mounted.wrapper
    store = mounted.store
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('面板默认离线可用：供应商是 Mock、展示规则检查与一键修复入口', () => {
    expect(wrapper.find('[data-role="ai-provider"]').exists()).toBe(true)
    expect((wrapper.find('[data-role="ai-provider"]').element as HTMLSelectElement).value).toBe('mock')
    expect(wrapper.find('[data-role="ai-issue-count"]').text()).toBe(String(store.aiIssues.length))
    expect(wrapper.find('[data-role="ai-fix-all"]').exists()).toBe(true)
    expect(wrapper.find('[data-role="ai-selection"]').text()).toBe('未选中元素')
    expect(wrapper.find('[data-role="ai-key"]').exists()).toBe(false)
  })

  it('接口设置折叠后可保存到本机，OpenAI 选项随之可用', async () => {
    await wrapper.find('[data-role="ai-settings-toggle"]').trigger('click')
    await wrapper.find('[data-role="ai-key"]').setValue('sk-local-only')
    await wrapper.find('[data-role="ai-model"]').setValue('my-model')
    await wrapper.find('[data-role="ai-settings-save"]').trigger('click')
    await flush()
    const openai = store.aiProviders.find((item) => item.id === 'openai')
    expect(openai?.ready).toBe(true)
    expect(store.aiSettings.model).toBe('my-model')
    expect(JSON.stringify(store.doc)).not.toContain('sk-local-only')
    expect(localStorage.getItem('studio.ai.settings.v1')).toContain('sk-local-only')
  })

  it('一句话生成页面：插入新页面、写入历史、可撤销', async () => {
    const pagesBefore = store.pages.length
    const initialPageId = store.activePage.id
    await wrapper.find('[data-role="ai-page-prompt"]').setValue('做一个读书会落地页')
    await wrapper.find('[data-role="ai-generate"]').trigger('click')
    await flush()
    expect(store.pages.length).toBe(pagesBefore + 1)
    expect(store.activePage.name).toContain('读书会')
    expect(store.labels.at(-1)).toMatch(/^AI 生成页面：/)
    expect((wrapper.find('[data-role="ai-page-prompt"]').element as HTMLTextAreaElement).value).toBe('')
    store.undo()
    await nextTick()
    expect(store.pages.length).toBe(pagesBefore)
    expect(store.activePage.id).toBe(initialPageId)
  })

  it('选区指令只改选中子树，其它节点 JSON 逐字节不变', async () => {
    const target = store.insertComponent('text')
    const other = store.insertComponent('heading')
    store.select(target)
    const othersBefore = store.topLevel
      .filter((node) => node.id !== target)
      .map((node) => JSON.stringify(node))
    await wrapper.find('[data-role="ai-instruction"]').setValue('把文案改成「立即预约」')
    await wrapper.find('[data-role="ai-edit"]').trigger('click')
    await flush()
    expect(store.labels.at(-1)).toMatch(/^AI 编辑：/)
    expect(store.nodes[target]?.props.text).toBe('立即预约')
    expect(store.nodes[other]?.props.text).not.toBe('立即预约')
    const othersAfter = store.topLevel
      .filter((node) => node.id !== target)
      .map((node) => JSON.stringify(node))
    expect(othersAfter).toEqual(othersBefore)
  })

  it('空选区时禁用「应用到选区」', async () => {
    expect(wrapper.find('[data-role="ai-selection"]').text()).toBe('未选中元素')
    expect((wrapper.find('[data-role="ai-edit"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('一键修复走一条可撤销的 AI 历史，问题数下降', async () => {
    const id = store.insertComponent('text')
    store.updateNode(id, { style: { color: '#F5F5F5' } })
    await nextTick()
    const before = store.aiIssues.length
    expect(store.aiIssues.some((issue) => issue.kind === 'contrast')).toBe(true)
    expect(wrapper.findAll('[data-role="ai-issue"]').length).toBe(before)
    await wrapper.find('[data-role="ai-fix-all"]').trigger('click')
    await flush()
    expect(store.labels.at(-1)).toBe('AI 一键修复')
    expect(store.aiIssues.length).toBeLessThan(before)
    expect(store.aiIssues.every((issue) => issue.patches.length === 0)).toBe(true)
    store.undo()
    await nextTick()
    expect(store.aiIssues.some((issue) => issue.kind === 'contrast')).toBe(true)
  })
})
