import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditorShell from '@/components/editor/EditorShell.vue'
import { componentLabel } from '@/core/components'
import { useEditorStore } from '@/stores/editor'
import { installLayout } from './helpers'

/**
 * 图层面板的中文类型名与删除入口（M10：用户 m09506 反馈）。
 *
 * 锁住两件事：
 * - 图层/属性面板/画布角标里的类型名必须是中文（不能直接渲染 `text`/`section`）；
 * - 图层行里要有一个能直接点的删除按钮，走和 Delete 键同一条 `removeSelection()`，
 *   删容器连子孙一起删、锁定元素给提示而不是静默失败。
 */
describe('图层：中文类型名与删除', () => {
  let wrapper: ReturnType<typeof mount>
  let store: ReturnType<typeof useEditorStore>

  async function flush(): Promise<void> {
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()
  }

  async function mountShell(): Promise<void> {
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useEditorStore()
    store.newProject()
    wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush()
  }

  function layerRow(id: string): ReturnType<typeof wrapper.find> {
    return wrapper.find(`[data-layer-id="${id}"]`)
  }

  beforeEach(() => {
    localStorage.clear()
    installLayout()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('componentLabel 给中文名，未知类型原样返回', () => {
    expect(componentLabel('text')).toBe('文本')
    expect(componentLabel('section')).toBe('区块')
    expect(componentLabel('frame')).toBe('容器')
    expect(componentLabel('not-registered')).toBe('not-registered')
  })

  it('图层行显示中文类型名', async () => {
    await mountShell()
    const sectionId = store.insertComponent('section')
    const textId = store.insertComponent('text', { parentId: sectionId })
    await flush()

    expect(layerRow(sectionId).text()).toContain('区块')
    expect(layerRow(textId).text()).toContain('文本')
    expect(layerRow(sectionId).text()).not.toContain('section')
  })

  it('属性面板的类型名也是中文', async () => {
    await mountShell()
    const textId = store.insertComponent('text')
    await flush()
    store.select(textId)
    await flush()

    const propType = wrapper.find('[data-role="prop-type"]')
    expect(propType.text()).toContain('文本')
    expect(propType.text()).not.toContain('text  ')
  })

  it('图层行的删除按钮删掉元素，容器连子孙一起删', async () => {
    await mountShell()
    const sectionId = store.insertComponent('section')
    const textId = store.insertComponent('text', { parentId: sectionId })
    const otherId = store.insertComponent('text')
    await flush()

    await wrapper.find(`[data-delete-id="${sectionId}"]`).trigger('click')
    await flush()

    expect(store.nodes[sectionId]).toBeUndefined()
    expect(store.nodes[textId]).toBeUndefined()
    expect(store.nodes[otherId]).toBeDefined()
    expect(store.selectedIds).toEqual([])
  })

  it('图层行删除按钮对锁定元素给提示、不删除', async () => {
    await mountShell()
    const textId = store.insertComponent('text')
    await flush()
    store.updateNode(textId, { meta: { ...store.nodes[textId].meta, locked: true } })
    await flush()

    await wrapper.find(`[data-delete-id="${textId}"]`).trigger('click')
    await flush()

    expect(store.nodes[textId]).toBeDefined()
    expect(store.toasts.some((toast) => toast.text.includes('锁定'))).toBe(true)
  })

  it('顶栏删除按钮：没选中时禁用，选中后能删', async () => {
    await mountShell()
    const textId = store.insertComponent('text')
    await flush()

    store.clearSelection()
    await flush()
    const toolbarDelete = wrapper.find('[data-role="toolbar-delete"]')
    expect(toolbarDelete.attributes('disabled')).toBeDefined()

    store.select(textId)
    await flush()
    expect(wrapper.find('[data-role="toolbar-delete"]').attributes('disabled')).toBeUndefined()

    await wrapper.find('[data-role="toolbar-delete"]').trigger('click')
    await flush()
    expect(store.nodes[textId]).toBeUndefined()
  })
})
