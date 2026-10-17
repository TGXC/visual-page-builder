import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import { useEditorStore } from '@/stores/editor'
import { VERSIONS_KEY } from '@/core/versions'
import { installLayout } from './helpers'

/**
 * M8 组件测试：主题 token 面板、版本历史、分享链接、从模板新建页面。
 * 挂载范式与 `tests/component/output.spec.ts` 一致（真 pinia + 真 EditorShell + jsdom 布局垫片）。
 */

async function flush(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('M8：主题 / 版本 / 分享面板', () => {
  let wrapper: ReturnType<typeof mount>
  let store: ReturnType<typeof useEditorStore>

  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useEditorStore()
    store.newProject()
    installLayout()
    vi.useFakeTimers()
    wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('主题面板：添加 token → 元素引用 → 导出成 CSS 变量 → 删除', async () => {
    const input = wrapper.find('[data-role="theme-token-name"]')
    await input.setValue('color-primary')
    await wrapper.find('[data-role="theme-token-new-value"]').setValue('#2563EB')
    await wrapper.find('[data-role="theme-token-add"]').trigger('click')

    expect(store.themeTokens.map((token) => token.name)).toContain('color-primary')
    expect(wrapper.find('[data-role="theme-token"]').exists()).toBe(true)
    expect(store.labels.at(-1)).toBe('主题 token：color-primary')

    // 元素样式引用 token，导出必须是 var(--color-primary) + :root 定义
    const id = store.insertComponent('rect')
    store.updateNode(id, { style: { bg: '$color-primary' } })
    expect(store.generatedCss).toContain('var(--color-primary)')
    expect(store.generatedCss).toContain(':root{')

    // 改 token 值：所有引用一起变（同一份 CSS 变量）
    store.writeThemeToken('color-primary', '#E5484D')
    expect(store.generatedCss).toContain('--color-primary:#E5484D')

    await flush()
    const rows = wrapper.findAll('[data-role="theme-token"]')
    const target = rows.find((row) => row.text().includes('color-primary'))
    expect(target).toBeTruthy()
    await target!.find('[data-role="theme-token-delete"]').trigger('click')
    expect(store.themeTokens.map((token) => token.name)).not.toContain('color-primary')
    // 引用没定义时面板会提醒
    await flush()
    expect(wrapper.find('[data-role="theme-missing"]').text()).toContain('color-primary')
  })

  it('主题面板：变量名显示中文说明，英文原名仍然可见（样式里要引用它）', () => {
    const rows = wrapper.findAll('[data-role="theme-token"]')
    const primary = rows.find((row) => row.text().includes('color-primary'))
    expect(primary).toBeTruthy()
    expect(primary!.find('[data-role="theme-token-label"]').text()).toBe('主色')
    expect(primary!.find('code').text()).toBe('color-primary')
  })

  it('版本面板：保存版本 → 改成别的样子 → 回滚逐字节一致 → 回滚本身可撤销', async () => {
    const original = JSON.stringify(store.doc)
    await wrapper.find('[data-role="version-name"]').setValue('改版前')
    await wrapper.find('[data-role="version-save"]').trigger('click')
    expect(store.versionsCount).toBe(1)
    expect(localStorage.getItem(VERSIONS_KEY)).toContain('改版前')

    store.insertComponent('text')
    expect(JSON.stringify(store.doc)).not.toBe(original)

    await wrapper.find('[data-role="version-restore"]').trigger('click')
    expect(JSON.stringify(store.doc)).toBe(original)
    expect(store.labels.at(-1)).toBe('回滚版本：改版前')

    store.undo()
    expect(JSON.stringify(store.doc)).not.toBe(original)
  })

  it('版本面板：删除与清空', async () => {
    store.saveCurrentVersion('v1')
    store.saveCurrentVersion('v2')
    await flush()
    expect(wrapper.findAll('[data-role="version-item"]')).toHaveLength(2)

    await wrapper.findAll('[data-role="version-delete"]')[0]!.trigger('click')
    expect(store.versionsCount).toBe(1)

    await wrapper.find('[data-role="version-clear"]').trigger('click')
    expect(store.versionsCount).toBe(0)
    expect(wrapper.find('[data-role="version-item"]').exists()).toBe(false)
  })

  it('分享面板：链接含 #doc=，能从链接载入（文档一致且可撤销）', async () => {
    store.insertComponent('heading')
    const link = store.shareLink
    expect(link).toContain('#doc=')
    expect(wrapper.find('[data-role="share-link"]').element).toBeTruthy()

    const before = JSON.stringify(store.doc)
    store.newProject()
    expect(JSON.stringify(store.doc)).not.toBe(before)

    await wrapper.find('[data-role="share-open-input"]').setValue(link)
    await wrapper.find('[data-role="share-open"]').trigger('click')
    expect(JSON.stringify(store.doc)).toBe(before)
    expect(store.labels.at(-1)).toBe('打开分享链接')

    store.undo()
    expect(JSON.stringify(store.doc)).not.toBe(before)
  })

  it('坏分享链接给出错误提示，不改文档', () => {
    const before = JSON.stringify(store.doc)
    expect(store.openSharedDoc('#doc=%%%not-base64%%%')).toBe(false)
    expect(JSON.stringify(store.doc)).toBe(before)
    expect(store.toasts.at(-1)?.kind).toBe('error')
  })

  it('从模板新建页面：页面 +1、可撤销、模板下拉框在页面标签栏里', async () => {
    const pagesBefore = store.pages.length
    expect(wrapper.find('[data-role="template-select"]').exists()).toBe(true)
    await wrapper.find('[data-role="template-add"]').trigger('click')

    expect(store.pages.length).toBe(pagesBefore + 1)
    expect(store.labels.at(-1)).toMatch(/^从模板新建页面：/)
    expect(store.pages.at(-1)!.name).toBe('登录')

    store.undo()
    expect(store.pages.length).toBe(pagesBefore)
  })

  it('E8 键盘：Alt + 方向键在整棵树里切换选中项', async () => {
    store.insertComponent('text')
    store.insertComponent('heading')
    const start = store.topLevel[0]!.id
    store.select(start)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }))
    await flush()
    expect(store.selection.length).toBe(1)
    expect(store.selection[0]!.id).not.toBe(start)
  })
})
