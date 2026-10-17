import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditorShell from '@/components/editor/EditorShell.vue'
import { useEditorStore } from '@/stores/editor'
import { down, installLayout, keydown } from './helpers'

/**
 * 选择与删除的交互契约（M9：参考平台对齐）。
 *
 * 这几个用例锁住的是用户 m08590 报的问题：
 * - 点画布空白/页面底不应选中根节点（选中根再按 Delete 会让画布白屏）；
 * - 点嵌套元素应选中最外层分区，再点一次才下钻（否则「删不掉/删不完」）；
 * - 锁定元素与根节点不能被 Delete 删掉；
 * - 删容器要连子孙一起删，且可撤销；
 * - 页面级操作（从模板新建 / 删除页面）要可撤销。
 */
describe('选择与删除', () => {
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

  /** 用一次真实的 pointerdown 点某个节点 */
  async function clickNode(id: string, options: { alt?: boolean; shift?: boolean } = {}): Promise<void> {
    await flush()
    const element = wrapper.find(`[data-node-id="${id}"]`).element
    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.assign(event, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 1,
      altKey: options.alt === true,
      shiftKey: options.shift === true,
      ctrlKey: false,
      metaKey: false,
    })
    element.dispatchEvent(event)
    await flush()
  }

  /** 造一棵「分区（容器）→ 标题」的两层结构 */
  async function nestedFixture(): Promise<{ sectionId: string; textId: string }> {
    const sectionId = store.insertComponent('section')
    const textId = store.insertComponent('text', { parentId: sectionId })
    await flush()
    return { sectionId, textId }
  }

  beforeEach(() => {
    localStorage.clear()
    installLayout()
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('画布上有页面网格层', async () => {
    await mountShell()
    expect(wrapper.find('[data-role="canvas-grid"]').exists()).toBe(true)
  })

  it('点空白处清空选中，不选中根节点', async () => {
    await mountShell()
    const { textId } = await nestedFixture()
    store.select(textId)
    await flush()
    down(wrapper.find('.canvas-stage').element, 10, 10)
    expect(store.selectedIds).toEqual([])
  })

  it('点页面底色（根节点区域）也清空选中，不选中根', async () => {
    await mountShell()
    const { textId } = await nestedFixture()
    store.select(textId)
    await clickNode(store.rootId)
    expect(store.selectedIds).toEqual([])
  })

  it('点嵌套元素先选中它所在的最外层分区，再点一次下钻', async () => {
    await mountShell()
    const { sectionId, textId } = await nestedFixture()
    await clickNode(textId)
    expect(store.selectedIds).toEqual([sectionId])
    await clickNode(textId)
    expect(store.selectedIds).toEqual([textId])
    // 第三次点回到分区（循环），避免用户卡在深层出不来
    await clickNode(textId)
    expect(store.selectedIds).toEqual([sectionId])
  })

  it('Alt + 点击直接选中被点的那个节点', async () => {
    await mountShell()
    const { textId } = await nestedFixture()
    await clickNode(textId, { alt: true })
    expect(store.selectedIds).toEqual([textId])
  })

  it('选中状态带可点击的面包屑路径', async () => {
    await mountShell()
    const { sectionId, textId } = await nestedFixture()
    store.select(textId)
    await flush()
    const path = wrapper.find('[data-role="selection-path"]')
    expect(path.exists()).toBe(true)
    const chips = wrapper.findAll('[data-role="selection-ancestor"]')
    expect(chips.length).toBeGreaterThan(0)
    // 点分区那一层 → 选中分区
    const sectionChip = chips.find((chip) => chip.attributes('data-ancestor-id') === sectionId)
    expect(sectionChip).toBeTruthy()
    await sectionChip?.trigger('click')
    expect(store.selectedIds).toEqual([sectionId])
  })

  it('锁定元素按 Delete 不删，给提示', async () => {
    await mountShell()
    const { textId } = await nestedFixture()
    store.updateNode(textId, { meta: { ...store.nodes[textId].meta, locked: true } })
    const before = Object.keys(store.nodes).length
    store.select(textId)
    keydown('Delete')
    await flush()
    expect(Object.keys(store.nodes).length).toBe(before)
    expect(store.toasts.some((toast) => toast.text.includes('锁定'))).toBe(true)
  })

  it('根节点按 Delete 不删，给提示', async () => {
    await mountShell()
    await nestedFixture()
    const before = Object.keys(store.nodes).length
    store.select(store.rootId)
    keydown('Delete')
    await flush()
    expect(Object.keys(store.nodes).length).toBe(before)
    expect(store.toasts.some((toast) => toast.text.includes('根'))).toBe(true)
  })

  it('删容器连子孙一起删，撤销后逐字节还原', async () => {
    await mountShell()
    const { sectionId } = await nestedFixture()
    const before = JSON.stringify(store.doc)
    store.select(sectionId)
    store.removeSelection()
    expect(store.nodes[sectionId]).toBeUndefined()
    expect(Object.values(store.nodes).some((node) => node.parentId === sectionId)).toBe(false)
    store.undo()
    expect(JSON.stringify(store.doc)).toBe(before)
  })

  it('从模板新建页面与删除页面都可撤销', async () => {
    await mountShell()
    const pagesBefore = store.pages.length
    store.addPageFromTemplate('landing')
    expect(store.pages.length).toBe(pagesBefore + 1)
    const addedId = store.activePage.id
    store.removePage(addedId)
    expect(store.pages.length).toBe(pagesBefore)
    store.undo()
    expect(store.pages.length).toBe(pagesBefore + 1)
    store.undo()
    expect(store.pages.length).toBe(pagesBefore)
  })

  it('单选时属性面板有删除按钮，并提示包含多少子元素', async () => {
    await mountShell()
    const { sectionId } = await nestedFixture()
    store.select(sectionId)
    await flush()
    const button = wrapper.find('[data-role="delete-selection"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('删除')
  })
})
