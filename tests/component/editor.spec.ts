import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import type { EditorStore } from '@/stores/editor'
import { useEditorStore } from '@/stores/editor'
import { down, drag, dropOn, installLayout, keydown, move, moveOn, up } from './helpers'

/** store 的改动要等一次 DOM 更新才能查到画布元素 */
async function flush(): Promise<void> {
  await nextTick()
  await nextTick()
}

function mountShell(): { wrapper: VueWrapper; store: EditorStore } {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useEditorStore()
  store.newProject()
  const wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, store }
}

function nodeEl(wrapper: VueWrapper, id: string): HTMLElement {
  const el = wrapper.element.querySelector(`.canvas-el[data-node-id="${id}"]`)
  if (!el) throw new Error(`缺少节点元素 ${id}`)
  return el as HTMLElement
}

describe('M1 编辑器：画布交互与面板', () => {
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

  it('组件面板列出 17 类组件与 6 套模板', () => {
    expect(wrapper.findAll('.palette-item').map((item) => item.attributes('data-type'))).toEqual([
      'text',
      'button',
      'input',
      'rect',
      'circle',
      'divider',
      'frame',
      'group',
      'nav',
      'header',
      'card',
      'select',
      'checkbox',
      'radio',
      'textarea',
      'image',
      'video',
    ])
    expect(wrapper.findAll('.template-item').map((item) => item.attributes('data-template'))).toEqual([
      'login',
      'landing',
      'profile',
      'pricing',
      'about',
      'blog',
    ])
  })

  it('点击组件面板往画布加元素，并出现在图层里', async () => {
    await wrapper.find('.palette-item[data-type="button"]').trigger('click')
    const id = Object.values(store.nodes).find((node) => node.type === 'button')!.id
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"]`).exists()).toBe(true)
    expect(wrapper.find(`.layer-row[data-layer-id="${id}"]`).exists()).toBe(true)
  })

  it('从面板拖入画布：元素落在指针位置', async () => {
    await wrapper.find('.palette-item[data-type="text"]').trigger('dragstart')
    dropOn(wrapper.find('.canvas-stage').element, 'text', 300, 200)
    await flush()
    const node = Object.values(store.nodes).find((item) => item.type === 'text')
    expect(node?.layout.position).toEqual({ x: 300, y: 200 })
    expect(wrapper.find(`.canvas-el[data-node-id="${node?.id}"]`).exists()).toBe(true)
  })

  it('拖动元素改位置，Ctrl+Z 撤销回原位', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    await flush()
    drag(nodeEl(wrapper, id), [140, 140], [340, 240])
    expect(store.nodes[id].layout.position).toEqual({ x: 300, y: 200 })
    keydown('z', { ctrlKey: true })
    expect(store.nodes[id].layout.position).toEqual({ x: 100, y: 100 })
  })

  it('位移不足 5px 不移动，只选中（点击与拖拽共存）', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    await flush()
    const rows = wrapper.findAll('.layer-row').length
    down(nodeEl(wrapper, id), 120, 120)
    move(123, 121)
    up(123, 121)
    expect(store.nodes[id].layout.position).toEqual({ x: 100, y: 100 })
    expect(store.selectedIds).toEqual([id])
    expect(wrapper.findAll('.layer-row').length).toBe(rows)
  })

  it('选中单个元素显示 8 个手柄，拖 se 手柄放大', async () => {
    const id = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.setSize(id, 200, 100, 'init')
    store.select(id)
    await flush()
    expect(wrapper.findAll(`.canvas-el[data-node-id="${id}"] .canvas-handle`)).toHaveLength(8)
    const handle = nodeEl(wrapper, id).querySelector('[data-handle="se"]') as HTMLElement
    drag(handle, [300, 200], [400, 300])
    expect(store.nodes[id].layout.size.w).toEqual({ kind: 'fixed', value: 300 })
    expect(store.nodes[id].layout.size.h).toEqual({ kind: 'fixed', value: 200 })
  })

  it('拖动接近邻居边缘时磁吸并显示参考线', async () => {
    const first = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.setSize(first, 200, 100, 'init')
    const second = store.insertComponent('rect', { position: { x: 500, y: 400 } })
    store.setSize(second, 100, 100, 'init')
    await flush()
    down(nodeEl(wrapper, second), 520, 420)
    move(324, 420)
    await flush()
    // 参考线只在拖动过程中显示（放手即清除，和 WebBuilder 一致）
    expect(wrapper.findAll('.canvas-guide--x').length).toBeGreaterThan(0)
    expect(store.nodes[second].layout.position.x).toBe(300)
    up(324, 420)
    await flush()
    expect(wrapper.findAll('.canvas-guide--x')).toHaveLength(0)
  })

  it('空白处框选多个元素后可批量对齐', async () => {
    store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.insertComponent('rect', { position: { x: 300, y: 100 } })
    await flush()
    const stage = wrapper.find('.canvas-stage').element
    down(stage, 50, 50)
    move(500, 300)
    up(500, 300)
    await flush()
    expect(store.selectedIds).toHaveLength(2)
    expect(wrapper.find('[data-role="multi-hint"]').exists()).toBe(true)
    await wrapper.find('[data-role="align-left"]').trigger('click')
    const rects = Object.values(store.nodes).filter((node) => node.type === 'rect')
    expect(new Set(rects.map((node) => node.layout.position.x))).toEqual(new Set([100]))
  })

  it('图层面板：选中、隐藏、锁定、双击改名', async () => {
    const id = store.insertComponent('button', { position: { x: 10, y: 10 } })
    await flush()
    const row = wrapper.find(`.layer-row[data-layer-id="${id}"]`)
    await row.trigger('click')
    expect(store.selectedIds).toEqual([id])

    await row.findAll('button')[0].trigger('click')
    expect(store.nodes[id].meta.hidden).toBe(true)

    await row.findAll('button')[1].trigger('click')
    expect(store.nodes[id].meta.locked).toBe(true)

    await row.trigger('dblclick')
    const input = wrapper.find('[data-role="layer-rename"]')
    expect(input.exists()).toBe(true)
    await input.setValue('主按钮')
    await input.trigger('blur')
    expect(store.nodes[id].meta.name).toBe('主按钮')
  })

  it('属性面板渲染 22 个白名单属性与位置尺寸', async () => {
    const id = store.insertComponent('text', { position: { x: 10, y: 20 } })
    store.setSize(id, 120, 40, 'init')
    store.select(id)
    await flush()
    const keys = wrapper.findAll('.prop-form [data-prop]').map((el) => el.attributes('data-prop'))
    for (const key of [
      'text',
      'sub',
      'placeholder',
      'src',
      'link',
      'bg',
      'color',
      'fontSize',
      'fontWeight',
      'align',
      'radius',
      'borderWidth',
      'borderColor',
      'opacity',
      'shadowBlur',
      'shadowX',
      'shadowY',
      'shadowColor',
      'lineHeight',
      'letterSpacing',
    ]) {
      expect(keys).toContain(key)
    }
    expect((wrapper.find('[data-role="pos-x"]').element as HTMLInputElement).value).toBe('10')
    expect((wrapper.find('[data-role="size-w"]').element as HTMLInputElement).value).toBe('120')
    expect(wrapper.find('[data-role="name"]').exists()).toBe(true)
    expect(wrapper.find('[data-role="hidden"]').exists()).toBe(true)
    expect(wrapper.find('[data-role="locked"]').exists()).toBe(true)
  })

  it('属性面板改文本立刻同步到画布与生成的 HTML', async () => {
    const id = store.insertComponent('text', { position: { x: 10, y: 10 } })
    store.updateNode(id, { props: { text: '旧文案' } })
    store.select(id)
    await flush()
    await wrapper.find('[data-prop="text"]').setValue('新文案')
    expect(store.nodes[id].props.text).toBe('新文案')
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"] .canvas-el__content`).text()).toContain('新文案')
    expect(store.generatedHtml).toContain('新文案')
    expect(store.generatedHtml).not.toContain('旧文案')
  })

  it('updateNode 的 style/props 是浅合并，不是整体替换（含撤销）', () => {
    const id = store.insertComponent('image', { position: { x: 0, y: 0 } })
    store.updateNode(id, { props: { src: 'a.png', text: '图' } })
    store.updateNode(id, { props: { text: '新图' } })
    expect(store.nodes[id].props.src).toBe('a.png')
    expect(store.nodes[id].props.text).toBe('新图')
    store.undo()
    expect(store.nodes[id].props.text).toBe('图')
    expect(store.nodes[id].props.src).toBe('a.png')
  })

  it('属性面板改一个样式键不会抹掉其它样式', async () => {
    const id = store.insertComponent('text', { position: { x: 10, y: 10 } })
    store.updateNode(id, { style: { ...store.nodes[id].style, bg: '#ff0000', color: '#00ff00' } })
    store.select(id)
    await flush()
    const fontSize = wrapper.find('[data-prop="fontSize"]')
    expect(fontSize.exists()).toBe(true)
    ;(fontSize.element as HTMLInputElement).value = '22'
    await fontSize.trigger('change')
    expect(store.nodes[id].style.fontSize).toBe(22)
    expect(store.nodes[id].style.bg).toBe('#ff0000')
    expect(store.nodes[id].style.color).toBe('#00ff00')
  })

  it('多页面：新增、切换、改名、删除', async () => {
    expect(store.pages).toHaveLength(1)
    await wrapper.find('[data-role="add-page"]').trigger('click')
    expect(store.pages).toHaveLength(2)
    expect(store.activePage?.id).toBe(store.pages[1].id)

    await wrapper.findAll('.page-tab')[0].trigger('click')
    expect(store.activePage?.id).toBe(store.pages[0].id)

    await wrapper.findAll('.page-tab')[1].trigger('dblclick')
    const input = wrapper.find('[data-role="page-rename"]')
    await input.setValue('关于我们')
    await input.trigger('blur')
    expect(store.pages[1].name).toBe('关于我们')

    await wrapper.findAll('.page-tab')[1].find('.page-tab__close').trigger('click')
    expect(store.pages).toHaveLength(1)
  })

  it('视口切换与画布缩放互相独立', async () => {
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 1440px')
    await wrapper.find('[data-role="viewport-mobile"]').trigger('click')
    expect(store.viewport().w).toBe(375)
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 375px')
    expect(wrapper.find('[data-role="viewport-label"]').text()).toContain('375')
    await wrapper.find('[data-role="zoom-in"]').trigger('click')
    expect(store.zoom).toBe(1.25)
    expect(wrapper.find('[data-role="zoom"]').text()).toBe('125%')
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 468.75px')
  })

  it('自定义视口宽度：画布宽度与文档设计宽度同步，切预设会覆盖', async () => {
    const width = wrapper.find('[data-role="viewport-width"]')
    expect(width.exists()).toBe(true)
    ;(width.element as HTMLInputElement).value = '1024'
    await width.trigger('change')
    expect(store.viewport().w).toBe(1024)
    expect(store.activePage?.viewport.w).toBe(1024)
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 1024px')

    await wrapper.find('[data-role="viewport-mobile"]').trigger('click')
    expect(store.viewport().w).toBe(375)
    expect(store.activePage?.viewport.w).toBe(375)
  })

  it('自定义视口宽度越界时夹取到 200..10000，非法输入忽略', async () => {
    async function typeWidth(value: string): Promise<void> {
      const input = wrapper.find('[data-role="viewport-width"]')
      ;(input.element as HTMLInputElement).value = value
      await input.trigger('change')
    }
    await typeWidth('999999')
    expect(store.viewport().w).toBe(10_000)
    await typeWidth('10')
    expect(store.viewport().w).toBe(200)
    await typeWidth('')
    expect(store.viewport().w).toBe(200)
    await typeWidth('abc')
    expect(store.viewport().w).toBe(200)
  })

  it('快捷键：方向键微移、复制、撤销重做、全选删除', async () => {
    const id = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.select(id)
    await flush()

    keydown('ArrowRight')
    expect(store.nodes[id].layout.position.x).toBe(101)
    keydown('ArrowDown', { shiftKey: true })
    expect(store.nodes[id].layout.position.y).toBe(110)

    keydown('d', { ctrlKey: true })
    expect(Object.keys(store.nodes)).toHaveLength(3)

    keydown('z', { ctrlKey: true })
    expect(Object.keys(store.nodes)).toHaveLength(2)
    keydown('z', { ctrlKey: true, shiftKey: true })
    expect(Object.keys(store.nodes)).toHaveLength(3)

    keydown('a', { ctrlKey: true })
    expect(store.selectedIds).toHaveLength(2)
    keydown('Delete')
    expect(Object.keys(store.nodes)).toHaveLength(1)

    keydown('z', { ctrlKey: true })
    expect(Object.keys(store.nodes)).toHaveLength(3)
  })

  it('右键菜单可复制粘贴', async () => {
    const id = store.insertComponent('card', { position: { x: 40, y: 40 } })
    store.select(id)
    await flush()
    nodeEl(wrapper, id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
    await flush()
    const menu = wrapper.find('[data-role="context-menu"]')
    expect(menu.exists()).toBe(true)
    await menu.find('[data-action="copy"]').trigger('click')
    store.select(null)
    wrapper
      .find('.canvas-stage')
      .element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    await flush()
    await wrapper.find('[data-role="context-menu"] [data-action="paste"]').trigger('click')
    expect(Object.keys(store.nodes)).toHaveLength(3)
  })

  it('自动保存：改动后 400ms 写入 localStorage', async () => {
    store.insertComponent('text', { position: { x: 10, y: 10 } })
    await flush()
    expect(localStorage.getItem('studio:doc:v2')).toBeNull()
    vi.advanceTimersByTime(400)
    const raw = localStorage.getItem('studio:doc:v2')
    expect(raw).toBeTruthy()
    expect(raw).toContain('"version":2')
  })

  it('状态栏显示指针坐标与选中尺寸', async () => {
    const id = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.setSize(id, 200, 50, 'init')
    store.select(id)
    await flush()
    moveOn(wrapper.find('.canvas-stage').element, 300, 250)
    await flush()
    expect(wrapper.find('[data-role="pointer"]').text()).toBe('300, 250')
    const box = wrapper.find('[data-role="selection-box"]').text()
    expect(box).toContain('x 100')
    expect(box).toContain('200 × 50')
  })
})
