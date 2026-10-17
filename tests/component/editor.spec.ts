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

  it('组件面板按分类列出 40 类组件与 6 套模板，并支持搜索过滤', async () => {
    const types = wrapper.findAll('.palette-item').map((item) => item.attributes('data-type'))
    expect(types).toHaveLength(40)
    expect(new Set(types).size).toBe(40)
    expect(types).toEqual(expect.arrayContaining(['text', 'button', 'frame', 'group', 'input', 'image', 'nav', 'switch', 'list']))

    const categories = wrapper.findAll('.palette-group').map((group) => group.attributes('data-category'))
    expect(categories).toEqual(['layout', 'basic', 'form', 'media', 'display'])

    const search = wrapper.find('[data-role="palette-search"]')
    expect(search.exists()).toBe(true)
    await search.setValue('表格')
    const filtered = wrapper.findAll('.palette-item').map((item) => item.attributes('data-type'))
    expect(filtered).toContain('table')
    expect(filtered).not.toContain('rect')
    await search.setValue('没有任何匹配')
    expect(wrapper.findAll('.palette-item')).toHaveLength(0)
    expect(wrapper.find('.palette-empty').exists()).toBe(true)
  })

  it('组件分类默认收起表单/媒体，点标题展开，搜索时自动全部展开', async () => {
    const gridOf = (category: string) =>
      wrapper.find(`.palette-group[data-category="${category}"] .palette-grid`).element as HTMLElement

    // 默认：布局 / 基础 / 展示展开，表单（12 个）和媒体（5 个）收起来
    expect(gridOf('layout').style.display).not.toBe('none')
    expect(gridOf('basic').style.display).not.toBe('none')
    expect(gridOf('display').style.display).not.toBe('none')
    expect(gridOf('form').style.display).toBe('none')
    expect(gridOf('media').style.display).toBe('none')
    // 收起只是 v-show：节点还在 DOM 里（搜索/计数/测试都靠它）
    expect(wrapper.findAll('.palette-group[data-category="form"] .palette-item')).toHaveLength(12)

    await wrapper.find('[data-role="palette-toggle-form"]').trigger('click')
    expect(gridOf('form').style.display).not.toBe('none')

    const search = wrapper.find('[data-role="palette-search"]')
    await search.setValue('按钮')
    const grids = wrapper.findAll('.palette-grid')
    expect(grids.length).toBeGreaterThan(0)
    expect(grids.every((grid) => (grid.element as HTMLElement).style.display !== 'none')).toBe(true)
  })

  it('组件面板列出 6 套模板', () => {
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

  it('拖动时显示到左右邻居的间距，等距时高亮，放手后消失', async () => {
    const left = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    const right = store.insertComponent('rect', { position: { x: 300, y: 100 } })
    const middle = store.insertComponent('rect', { position: { x: 200, y: 100 } })
    store.setBox(left, { x: 100, y: 100, w: 50, h: 50 }, 'init')
    store.setBox(right, { x: 300, y: 100, w: 50, h: 50 }, 'init')
    store.setBox(middle, { x: 200, y: 100, w: 50, h: 50 }, 'init')
    await flush()

    down(nodeEl(wrapper, middle), 220, 120)
    move(220, 130)
    await flush()

    const hints = wrapper.findAll('.canvas-spacing')
    expect(hints.map((hint) => hint.attributes('data-gap'))).toEqual(['50', '50'])
    expect(hints.every((hint) => hint.classes().includes('is-equal'))).toBe(true)

    // 不等距时仍然给两条提示，但不再高亮
    move(240, 130)
    await flush()
    expect(wrapper.findAll('.canvas-spacing').every((hint) => !hint.classes().includes('is-equal'))).toBe(true)

    up(240, 130)
    await flush()
    expect(wrapper.findAll('.canvas-spacing')).toHaveLength(0)
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

  it('拖到别的容器里会换父级，位置换算到新容器的内容框（画布上不动）', async () => {
    const frameId = store.insertComponent('frame', { position: { x: 100, y: 100 } })
    store.setSize(frameId, 300, 300, 'init')
    const textId = store.insertComponent('text', { position: { x: 600, y: 600 } })
    await flush()

    drag(nodeEl(wrapper, textId), [620, 620], [250, 250])

    expect(store.nodes[textId].parentId).toBe(frameId)
    // 内容框原点 = 容器盒 + padding(0)；位置换算成相对坐标，屏幕上仍然是拖到的位置
    const box = store.boxes[textId]
    expect(box.x).toBe(230)
    expect(store.nodes[textId].layout.position).toEqual({ x: box.x - 100, y: box.y - 100 })
    keydown('z', { ctrlKey: true })
    expect(store.nodes[textId].parentId).toBe(store.rootId)
  })

  it('拖进另一个容器时显示落点高亮与插入位指示线', async () => {
    const frameId = store.insertComponent('frame', { position: { x: 100, y: 100 } })
    store.setSize(frameId, 300, 300, 'init')
    const textId = store.insertComponent('text', { position: { x: 600, y: 600 } })
    await flush()

    down(nodeEl(wrapper, textId), 620, 620)
    move(300, 300)
    await flush()
    expect(wrapper.find('.canvas-drop-hint').exists()).toBe(true)
    expect(wrapper.find('.canvas-insert-line').exists()).toBe(true)
    up(300, 300)
    await flush()
    expect(wrapper.find('.canvas-drop-hint').exists()).toBe(false)
  })

  it('布局面板：容器切到流式排布再切回自由，位置数据不丢（元素回到原处）', async () => {
    const frameId = store.insertComponent('frame', { position: { x: 100, y: 100 } })
    store.setSize(frameId, 300, 300, 'init')
    const textId = store.insertComponent('text', { parentId: frameId, position: { x: 40, y: 60 } })
    await flush()
    const before = store.boxes[textId]

    store.select(frameId)
    await flush()
    expect(wrapper.find('[data-role="layout-panel"]').exists()).toBe(true)

    await wrapper.find('[data-role="layout-mode-vertical"]').trigger('click')
    expect(store.nodes[frameId].layout.mode).toBe('vertical')
    // 流式排布下位置由布局算：文本被摆到内容框顶部，坐标数据本身没被改
    expect(store.nodes[textId].layout.position).toEqual({ x: 40, y: 60 })
    expect(store.boxes[textId].y).not.toBe(before.y)

    await wrapper.find('[data-role="layout-mode-free"]').trigger('click')
    expect(store.nodes[frameId].layout.mode).toBe('free')
    // 切回自由：位置没被动过，元素回到原来的地方
    expect(store.nodes[textId].layout.position).toEqual({ x: 40, y: 60 })
    expect(store.boxes[textId]).toEqual(before)
  })

  it('布局面板：间距/内边距/对齐/尺寸模式写进节点，且不抹掉别的字段', async () => {
    const id = store.insertComponent('rect', { position: { x: 10, y: 10 } })
    store.select(id)
    await flush()

    await wrapper.find('[data-role="layout-align-center"]').trigger('click')
    await wrapper.find('[data-role="layout-size-h-hug"]').trigger('click')
    const gap = wrapper.find('[data-role="layout-gap"]')
    ;(gap.element as HTMLInputElement).value = '12'
    await gap.trigger('change')
    const padTop = wrapper.find('[data-role="layout-padding-top"]')
    ;(padTop.element as HTMLInputElement).value = '8'
    await padTop.trigger('change')

    const layout = store.nodes[id].layout
    expect(layout.align).toBe('center')
    expect(layout.size.h.kind).toBe('hug')
    expect(layout.gap).toBe(12)
    expect(layout.padding).toEqual({ top: 8, right: 0, bottom: 0, left: 0 })
    expect(layout.position).toEqual({ x: 10, y: 10 })
    // 没选中的元素不该被改到
    expect(store.nodes[store.rootId].layout.mode).toBe('free')
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

  it('尺寸区显示「宽 × 高」，预设有名字和尺寸，画布与文档同步', async () => {
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 1440px')
    expect(wrapper.find('[data-role="viewport-desktop"]').text()).toContain('1440 × 900')
    expect(wrapper.find('[data-role="viewport-label"]').text()).toBe('1440 × 900')

    await wrapper.find('[data-role="viewport-mobile"]').trigger('click')
    expect(store.viewport().w).toBe(375)
    expect(store.viewport().h).toBe(812)
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 375px')
    expect(wrapper.find('[data-role="viewport-label"]').text()).toBe('375 × 812')

    await wrapper.find('[data-role="zoom-in"]').trigger('click')
    expect(store.zoom).toBe(1.25)
    expect(wrapper.find('[data-role="zoom"]').text()).toBe('125%')
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 468.75px')
  })

  it('视口高度可以单独改：画布高度、文档设计高度、尺寸标签一起变', async () => {
    const height = wrapper.find('[data-role="viewport-height"]')
    expect(height.exists()).toBe(true)
    ;(height.element as HTMLInputElement).value = '720'
    await height.trigger('change')
    expect(store.viewport().h).toBe(720)
    expect(store.activePage?.viewport.h).toBe(720)
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('height: 720px')
    expect(wrapper.find('[data-role="viewport-label"]').text()).toBe('1440 × 720')
  })

  it('视口高度越界时夹取到 200..10000，非法输入忽略', async () => {
    async function typeHeight(value: string): Promise<void> {
      const input = wrapper.find('[data-role="viewport-height"]')
      ;(input.element as HTMLInputElement).value = value
      await input.trigger('change')
    }
    await typeHeight('999999')
    expect(store.viewport().h).toBe(10_000)
    await typeHeight('10')
    expect(store.viewport().h).toBe(200)
    await typeHeight('')
    expect(store.viewport().h).toBe(200)
    await typeHeight('abc')
    expect(store.viewport().h).toBe(200)
  })

  it('缩放输入框显示当前百分比，可以直接输入任意数值，越界夹到 25%–200%', async () => {
    const input = wrapper.find('[data-role="zoom-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('100')

    await wrapper.find('[data-role="zoom-in"]').trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('125')

    // 手输非整档（「适应」算出来的 113% 这类值也要能输入）
    ;(input.element as HTMLInputElement).value = '37'
    await input.trigger('change')
    expect(store.zoom).toBe(0.37)
    expect((input.element as HTMLInputElement).value).toBe('37')

    // 清空输入不改缩放，只把框恢复成当前值
    ;(input.element as HTMLInputElement).value = ''
    await input.trigger('change')
    expect(store.zoom).toBe(0.37)
    expect((input.element as HTMLInputElement).value).toBe('37')

    // 越界夹取
    ;(input.element as HTMLInputElement).value = '900'
    await input.trigger('change')
    expect(store.zoom).toBe(2)
    expect((input.element as HTMLInputElement).value).toBe('200')

    ;(input.element as HTMLInputElement).value = '5'
    await input.trigger('change')
    expect(store.zoom).toBe(0.25)
    expect((input.element as HTMLInputElement).value).toBe('25')
  })

  it('一键清空：空页面置灰，有元素后点一下清空整页，撤销能整页恢复', async () => {
    const clearButton = wrapper.find('[data-role="toolbar-clear"]')
    expect(clearButton.attributes('disabled')).toBeDefined()

    store.insertComponent('text', { position: { x: 40, y: 40 } })
    store.insertComponent('rect', { position: { x: 120, y: 40 } })
    await flush()
    expect(clearButton.attributes('disabled')).toBeUndefined()

    await clearButton.trigger('click')
    expect(store.topLevel).toHaveLength(0)
    expect(store.selectedIds).toHaveLength(0)
    expect(wrapper.findAll('.canvas-el')).toHaveLength(1) // 只剩根容器
    expect(clearButton.attributes('disabled')).toBeDefined()

    keydown('z', { ctrlKey: true })
    await flush()
    expect(store.topLevel).toHaveLength(2)
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
