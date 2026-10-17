import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditorShell from '@/components/editor/EditorShell.vue'
import { useEditorStore } from '@/stores/editor'
import { installLayout } from './helpers'

/**
 * 右键菜单的契约（M12，用户 m10165：右键看不到删除项）。
 *
 * 之前的问题是两条独立原因叠在一起：
 * - 右键页面空白命中根 frame → 把根塞进选区 → 「删除」被置灰、文案换成一句解释，
 *   菜单里就找不到「删除」这个词了；
 * - 模板页根 frame 的底色没画在了标记里，一右键就是「页面画布删不掉」。
 *
 * 现在：右键空白不动选区、删除项永远叫「删除」，不可用的原因写在 title 上。
 */
describe('右键菜单', () => {
  let pinia: ReturnType<typeof createPinia>
  let wrapper: ReturnType<typeof mount>
  let store: ReturnType<typeof useEditorStore>

  async function flush(): Promise<void> {
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()
  }

  async function mountShell(): Promise<void> {
    pinia = createPinia()
    setActivePinia(pinia)
    store = useEditorStore()
    store.newProject()
    wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush()
  }

  /** 派发一次 contextmenu（jsdom 不会自己派发，必须手动 dispatch） */
  async function rightClick(element: Element): Promise<void> {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    await flush()
  }

  function deleteItem(): DOMWrapper<Element> {
    return wrapper.find('[data-role="context-menu"] [data-action="delete"]')
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

  it('右键元素会选中它，删除项可用且文案就是「删除」', async () => {
    await mountShell()
    const rectId = store.insertComponent('rect')
    await flush()
    store.clearSelection()
    await flush()
    await rightClick(wrapper.find(`[data-node-id="${rectId}"]`).element)
    expect(store.selectedIds).toEqual([rectId])
    const item = deleteItem()
    expect(item.exists()).toBe(true)
    expect(item.text()).toBe('删除')
    expect(item.attributes('disabled')).toBeUndefined()
    await item.trigger('click')
    await flush()
    expect(store.nodes[rectId]).toBeUndefined()
  })

  it('右键页面空白（根 frame）不改选区，菜单里仍然有「删除」', async () => {
    await mountShell()
    await rightClick(wrapper.find(`[data-node-id="${store.rootId}"]`).element)
    expect(store.selectedIds).toEqual([])
    const item = deleteItem()
    expect(item.exists()).toBe(true)
    expect(item.text()).toBe('删除')
    expect(item.attributes('disabled')).toBeDefined()
    expect(item.attributes('title')).toContain('先选中')
  })

  it('已选中元素后右键页面空白，删除项仍然可用并删掉那个元素', async () => {
    await mountShell()
    const rectId = store.insertComponent('rect')
    await flush()
    store.select(rectId)
    await flush()
    await rightClick(wrapper.find(`[data-node-id="${store.rootId}"]`).element)
    expect(store.selectedIds).toEqual([rectId])
    const item = deleteItem()
    expect(item.attributes('disabled')).toBeUndefined()
    await item.trigger('click')
    await flush()
    expect(store.nodes[rectId]).toBeUndefined()
  })

  it('右键锁定元素：删除项置灰，title 说明原因', async () => {
    await mountShell()
    const rectId = store.insertComponent('rect')
    await flush()
    store.updateNode(rectId, { meta: { ...store.nodes[rectId].meta, locked: true } })
    store.clearSelection()
    await flush()
    await rightClick(wrapper.find(`[data-node-id="${rectId}"]`).element)
    expect(store.selectedIds).toEqual([rectId])
    const item = deleteItem()
    expect(item.attributes('disabled')).toBeDefined()
    expect(item.text()).toBe('删除')
    expect(item.attributes('title')).toContain('锁定')
  })

  it('只有根被程序性选中时删除项仍叫「删除」，title 说明是页面画布', async () => {
    await mountShell()
    store.select(store.rootId)
    await flush()
    await rightClick(wrapper.find(`[data-node-id="${store.rootId}"]`).element)
    const item = deleteItem()
    expect(item.text()).toBe('删除')
    expect(item.attributes('disabled')).toBeDefined()
    expect(item.attributes('title')).toContain('页面画布')
  })
})
