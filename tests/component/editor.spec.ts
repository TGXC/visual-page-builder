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

  it('M22：点击组件面板只在右侧显示默认属性与说明，不插入画布', async () => {
    const before = Object.keys(store.nodes).length
    await wrapper.find('.palette-item[data-type="button"]').trigger('click')
    await flush()

    // 点击只选中，不新增元素
    expect(Object.keys(store.nodes).length).toBe(before)
    // 右侧换成这个组件的默认属性与说明
    expect(wrapper.find('[data-role="palette-props"]').exists()).toBe(true)
    expect(wrapper.find('[data-role="palette-type"]').text()).toContain('按钮')
    expect(wrapper.find('[data-role="palette-category"]').text()).toBe('基础')
    expect(wrapper.find('[data-role="palette-size"]').text()).toMatch(/^\d+ × \d+$/)
    expect(wrapper.find('[data-role="palette-doc"]').text().length).toBeGreaterThan(0)
    expect(wrapper.find('[data-role="props-empty"]').exists()).toBe(false)
    // 面板项高亮，再点一次取消
    expect(wrapper.find('.palette-item[data-type="button"]').classes()).toContain('is-active')
    await wrapper.find('.palette-item[data-type="button"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-role="palette-props"]').exists()).toBe(false)
    expect(wrapper.find('[data-role="props-empty"]').exists()).toBe(true)
    expect(wrapper.find('.palette-item[data-type="button"]').classes()).not.toContain('is-active')
  })

  it('M22：点选组件面板后选中画布元素，右侧回到元素属性', async () => {
    const id = store.insertComponent('text', { position: { x: 40, y: 40 } })
    await wrapper.find('.palette-item[data-type="table"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-role="palette-props"]').exists()).toBe(true)

    store.select(id)
    await flush()
    expect(wrapper.find('[data-role="palette-props"]').exists()).toBe(false)
    expect(wrapper.find('[data-role="prop-type"]').text()).toContain('文本')
    expect(wrapper.find('.palette-item[data-type="table"]').classes()).not.toContain('is-active')
  })

  it('从面板拖入画布：元素落在指针位置', async () => {
    await wrapper.find('.palette-item[data-type="text"]').trigger('dragstart')
    dropOn(wrapper.find('.canvas-stage').element, 'text', 300, 200)
    await flush()
    const node = Object.values(store.nodes).find((item) => item.type === 'text')
    expect(node?.layout.position).toEqual({ x: 300, y: 200 })
    expect(wrapper.find(`.canvas-el[data-node-id="${node?.id}"]`).exists()).toBe(true)
  })

  it('拖入只接受组件类型：画布里拖图片/链接等原生 drag 带进来的 URL 不会被插成组件', async () => {
    const stage = wrapper.find('.canvas-stage').element
    const before = Object.keys(store.nodes).length
    dropOn(stage, 'https://example.com/a.png', 300, 200)
    dropOn(stage, '从左侧拖入组件', 300, 200)
    await flush()
    expect(Object.keys(store.nodes).length).toBe(before)
  })

  it('同一次拖拽连发两个 drop 只插入一个组件', async () => {
    const stage = wrapper.find('.canvas-stage').element
    const before = Object.keys(store.nodes).length
    dropOn(stage, 'text', 300, 200)
    dropOn(stage, 'text', 300, 200)
    await flush()
    expect(Object.keys(store.nodes).length).toBe(before + 1)
  })

  it('拖动元素只移动、不复制（元素数量不变）', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    await flush()
    const before = Object.keys(store.nodes).length
    drag(nodeEl(wrapper, id), [140, 140], [340, 240])
    await flush()
    expect(Object.keys(store.nodes).length).toBe(before)
    expect(store.nodes[id].layout.position).toEqual({ x: 300, y: 200 })
  })

  it('状态栏显示当前界面版本号（对不上就是浏览器缓存了旧文件）', async () => {
    expect(wrapper.find('[data-role="build-tag"]').text()).toBe('M23')
  })

  it('拖动元素改位置，Ctrl+Z 撤销回原位', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    await flush()
    drag(nodeEl(wrapper, id), [140, 140], [340, 240])
    expect(store.nodes[id].layout.position).toEqual({ x: 300, y: 200 })
    keydown('z', { ctrlKey: true })
    expect(store.nodes[id].layout.position).toEqual({ x: 100, y: 100 })
  })

  it('缩放 50% 时拖动 100 屏幕像素 = 移动 200 设计像素（元素跟着鼠标走）', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    store.setZoom(0.5)
    await flush()
    down(nodeEl(wrapper, id), 140, 140)
    move(240, 140)
    up(240, 140)
    expect(store.nodes[id].layout.position).toEqual({ x: 300, y: 100 })
  })

  it('拖动期间画布容器位移（滚动条出现/页面被挤动）不会让元素相对鼠标漂移', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    await flush()
    const page = wrapper.find('.canvas-page').element as HTMLElement
    let pageLeft = 0
    page.getBoundingClientRect = () => {
      const rect = { left: pageLeft, top: 0, width: 1440, height: 900 } as DOMRect
      return rect
    }
    down(nodeEl(wrapper, id), 140, 140)
    move(240, 140)
    // 拖到一半时画布容器因为滚动条出现被挤动 120px
    pageLeft = 120
    move(340, 140)
    up(340, 140)
    // 屏幕位移 200px ⇒ 设计位移 200px，而不是被容器位移吃掉 120px
    expect(store.nodes[id].layout.position).toEqual({ x: 300, y: 100 })
  })

  it('窄断点（mobile）下拖动从屏幕位置继续走，不跳回基准断点坐标', async () => {
    const id = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.setBox(id, { x: 100, y: 100, w: 300, h: 100 }, 'init')
    await flush()
    store.setBreakpoint('mobile')
    await flush()
    store.setBox(id, { x: 10, y: 10, w: 100, h: 50 }, 'mobile')
    await flush()
    // 屏幕上按下 (40,30)、右移 20px：元素应该从 (10,10) 走到 (30,10)
    down(nodeEl(wrapper, id), 40, 30)
    move(60, 30)
    up(60, 30)
    await flush()
    expect(store.resolvedNodes[id].layout.position).toEqual({ x: 30, y: 10 })
    // 尺寸按窄断点的 100×50 走，不能被基准断点的 300×100 顶掉
    expect(store.resolvedNodes[id].layout.size.w.value).toBe(100)
    expect(store.resolvedNodes[id].layout.size.h.value).toBe(50)
    // 基准断点几何保持原样
    expect(store.nodes[id].layout.position).toEqual({ x: 100, y: 100 })
  })

  it('窄断点下缩放沿屏幕上的边缘走，尺寸按窄断点算', async () => {
    const id = store.insertComponent('rect', { position: { x: 100, y: 100 } })
    store.setBox(id, { x: 100, y: 100, w: 300, h: 100 }, 'init')
    await flush()
    store.setBreakpoint('mobile')
    await flush()
    store.setBox(id, { x: 10, y: 10, w: 100, h: 50 }, 'mobile')
    await flush()
    const handle = nodeEl(wrapper, id).querySelector('[data-handle="se"]') as HTMLElement
    down(handle, 110, 60)
    move(130, 80)
    up(130, 80)
    await flush()
    expect(store.resolvedNodes[id].layout.size.w.value).toBe(120)
    expect(store.resolvedNodes[id].layout.size.h.value).toBe(70)
    expect(store.resolvedNodes[id].layout.position).toEqual({ x: 10, y: 10 })
  })

  it('拖动时磁吸参考线按绝对位置算（容器里的元素和外层元素能对齐）', async () => {
    const frame = store.insertComponent('frame', { position: { x: 100, y: 100 } })
    store.setBox(frame, { x: 100, y: 100, w: 400, h: 300 }, 'init')
    const inside = store.insertComponent('rect', { position: { x: 500, y: 500 } })
    store.reparent([inside], frame)
    const outside = store.insertComponent('rect', { position: { x: 200, y: 500 } })
    store.setBox(outside, { x: 200, y: 500, w: 80, h: 80 }, 'init')
    // 容器内元素绝对盒 = 父盒(100) + 相对位置；放在外层元素左边缘附近 196 处，拖 2px 应该吸到 200
    store.setBox(inside, { x: 96, y: 0, w: 80, h: 80 }, 'init')
    await flush()
    expect(store.boxes[inside].x).toBe(196)
    // Alt 深选：直接拖容器里的元素（默认第一下点选的是外层容器）
    down(nodeEl(wrapper, inside), 200, 140, { altKey: true })
    move(206, 140)
    await flush()
    expect(store.boxes[inside].x).toBe(200)
    up(206, 140)
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

  it('缩放层以左上角为原点，画布尺寸与缩放层尺寸对得上（内容不会相对画布偏移）', async () => {
    const inner = wrapper.find('.canvas-page__inner')
    expect(inner.exists()).toBe(true)
    // 默认 transform-origin 是 50% 50%，会让内容相对 .canvas-page 整体偏移（用户实测的错位）
    expect((inner.element as HTMLElement).style.transformOrigin).toBe('0 0')

    await wrapper.find('[data-role="zoom-out"]').trigger('click')
    expect(store.zoom).toBe(0.75)
    expect((inner.element as HTMLElement).style.transform).toBe('scale(0.75)')
    expect((inner.element as HTMLElement).style.transformOrigin).toBe('0 0')
    // 外层画布按 zoom 收缩，缩放层保持设计尺寸（1440×900），靠 transform 缩放
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 1080px')
    expect((inner.element as HTMLElement).style.width).toBe('1440px')
    expect((inner.element as HTMLElement).style.height).toBe('900px')
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

  it('M20：双击布局组件也能输入文字，画布用角标显示（默认文字不显示）', async () => {
    const id = store.insertComponent('section', { position: { x: 40, y: 40 } })
    store.setSize(id, 320, 180, 'init')
    await flush()
    // 默认文字（容器默认名）不显示角标，避免每个容器顶着「容器」字样
    expect(nodeEl(wrapper, id).querySelector('.el__caption')).toBeNull()

    nodeEl(wrapper, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    const editor = wrapper.find('[data-role="text-editor"]')
    expect(editor.exists()).toBe(true)
    expect((editor.element as HTMLInputElement).placeholder).toBe('文字内容')
    await editor.setValue('营销活动区')
    await editor.trigger('keydown', { key: 'Enter' })
    await flush()

    expect(store.nodes[id].props.text).toBe('营销活动区')
    const caption = nodeEl(wrapper, id).querySelector('.el__caption')
    expect(caption?.textContent).toBe('营销活动区')
    expect(store.generatedHtml).toContain('营销活动区')
  })

  it('M20：双击输入框写的是占位文字（画布上马上能看到）', async () => {
    const id = store.insertComponent('input', { position: { x: 40, y: 40 } })
    store.setSize(id, 220, 40, 'init')
    await flush()

    nodeEl(wrapper, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    const editor = wrapper.find('[data-role="text-editor"]')
    expect((editor.element as HTMLInputElement).placeholder).toBe('占位文字')
    await editor.setValue('请输入手机号')
    await editor.trigger('keydown', { key: 'Enter' })
    await flush()

    expect(store.nodes[id].props.placeholder).toBe('请输入手机号')
    // 改的是 placeholder，没去动看不见的 text
    expect(store.nodes[id].props.text).not.toBe('请输入手机号')
    // 画布上立刻能看到（输入类在画布里渲染成提示文字）
    expect(nodeEl(wrapper, id).querySelector('.canvas-el__content')?.textContent).toContain('请输入手机号')
    expect(store.generatedHtml).toContain('placeholder="请输入手机号"')
  })

  it('M20：表格「水平对齐」真的生效，且不会被 th/td 的默认对齐全吃掉', async () => {
    const id = store.insertComponent('table', { position: { x: 10, y: 10 } })
    store.updateNode(id, { style: { ...store.nodes[id].style, align: 'center' } })
    await flush()

    // 画布元素上真的带上了 text-align
    expect(nodeEl(wrapper, id).style.textAlign).toBe('center')
    // 生成的节点 CSS 也带上了
    expect(store.generatedCss).toContain('text-align:center')
    // 基础样式里 th/td 必须是 inherit，否则会把上面这条盖掉
    expect(store.generatedHtml).toContain('text-align: inherit')
    expect(store.generatedHtml).not.toContain('border: 1px solid var(--studio-border')
  })

  it('M21：空容器的预设提示在输入文字后消失，清空后也不会回来（提示删得掉）', async () => {
    const id = store.insertComponent('container', { position: { x: 40, y: 40 } })
    store.setSize(id, 320, 180, 'init')
    await flush()
    expect(nodeEl(wrapper, id).querySelector('.canvas-el__muted')?.textContent).toBe('空容器')

    nodeEl(wrapper, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    await wrapper.find('[data-role="text-editor"]').setValue('我的区域')
    await wrapper.find('[data-role="text-editor"]').trigger('keydown', { key: 'Enter' })
    await flush()

    // 用户文字替换掉预设提示，画布里只剩自己的文字
    expect(nodeEl(wrapper, id).querySelector('.canvas-el__muted')).toBeNull()
    expect(nodeEl(wrapper, id).querySelector('.el__caption')?.textContent).toBe('我的区域')

    // 再把文字清空：预设提示也不能回来，否则等于「无法删除预设文本」
    nodeEl(wrapper, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    await wrapper.find('[data-role="text-editor"]').setValue('')
    await wrapper.find('[data-role="text-editor"]').trigger('keydown', { key: 'Enter' })
    await flush()
    expect(nodeEl(wrapper, id).querySelector('.canvas-el__muted')).toBeNull()
    expect(nodeEl(wrapper, id).querySelector('.el__caption')).toBeNull()
  })

  it('M21：输入框/文本域默认文字是正文色，新建就能看到提示，且提示可删', async () => {
    const inputId = store.insertComponent('input', { position: { x: 40, y: 40 } })
    const textareaId = store.insertComponent('textarea', { position: { x: 40, y: 120 } })
    await flush()

    expect(nodeEl(wrapper, inputId).querySelector('.canvas-el__content')?.textContent).toContain('请输入…')
    expect(nodeEl(wrapper, textareaId).querySelector('.canvas-el__content')?.textContent).toContain('请输入内容…')
    // 正文色 #1E293B，不再是 v1 的占位灰 #64748B
    expect(nodeEl(wrapper, inputId).style.color).toBe('rgb(30, 41, 59)')
    expect(nodeEl(wrapper, textareaId).style.color).toBe('rgb(30, 41, 59)')

    // 双击改的是 placeholder，清空即删掉预设提示
    nodeEl(wrapper, inputId).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    const editor = wrapper.find('[data-role="text-editor"]')
    await editor.setValue('')
    await editor.trigger('keydown', { key: 'Enter' })
    await flush()
    expect(store.nodes[inputId].props.placeholder).toBe('')
    expect(nodeEl(wrapper, inputId).querySelector('.canvas-el__content')?.textContent).toBe('')
  })

  it('M23：新插入的组件按落点推断锚定（贴右边 → 固定右边距）', async () => {
    // rect 默认 160×100，放在 x=1280 刚好贴住桌面 1440 的右边缘
    const id = store.insertComponent('rect', { position: { x: 1280, y: 60 } })
    await flush()
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'right', v: 'top' })

    // 居中放的组件推断成水平居中
    const centered = store.insertComponent('rect', { position: { x: 640, y: 300 } })
    await flush()
    expect(store.nodes[centered].layout.constraints.h).toBe('center')
  })

  it('M23：手机上手动拖过之后锚定钉成 left/top，基准断点几何不受影响', async () => {
    const id = store.insertComponent('rect', { position: { x: 1280, y: 60 } })
    await flush()
    store.setBreakpoint('mobile')
    await flush()
    store.setAbsBox(id, { x: 40, y: 300, w: 120, h: 60 }, 'init')
    await flush()

    // 手机断点上是用户手摆的位置，不再被「固定右边距」换算推走
    expect(store.viewNodes[id].layout.position).toEqual({ x: 40, y: 300 })
    expect(store.viewNodes[id].layout.constraints).toEqual({ h: 'left', v: 'top' })
    expect(store.nodes[id].layout.position).toEqual({ x: 1280, y: 60 })
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'right', v: 'top' })
  })

  it('M23：属性面板能选水平/垂直锚定，窄断点上选的是该断点的覆盖', async () => {
    const id = store.insertComponent('text', { position: { x: 100, y: 100 } })
    store.select(id)
    await flush()
    const horizontal = wrapper.find('[data-role="constraint-h"]')
    expect(horizontal.exists()).toBe(true)
    expect((horizontal.element as HTMLSelectElement).value).toBe('left')

    // 基准断点上改：写节点本身
    await horizontal.setValue('center')
    await flush()
    expect(store.nodes[id].layout.constraints.h).toBe('center')

    // 窄断点上改：写该断点的覆盖，基准仍然是 center
    store.setBreakpoint('mobile')
    await flush()
    store.select(id)
    await flush()
    expect((wrapper.find('[data-role="constraint-h"]').element as HTMLSelectElement).value).toBe('center')
    await wrapper.find('[data-role="constraint-v"]').setValue('bottom')
    await flush()
    expect(store.nodes[id].overrides.mobile?.layout?.constraints?.v).toBe('bottom')
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'center', v: 'top' })
  })

  it('M23：「按位置自动适配整页」给整页节点推断锚定（已在撤销栈里）', async () => {
    const id = store.insertComponent('rect', { position: { x: 40, y: 40 } })
    store.setAbsBox(id, { x: 640, y: 300, w: 160, h: 100 }, 'init')
    store.select(id)
    await flush()
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'left', v: 'top' })

    await wrapper.find('[data-role="auto-adapt"]').trigger('click')
    await flush()
    // 640 + 160/2 = 720 = 1440/2 ⇒ 水平居中
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'center', v: 'top' })
    expect(store.canUndo).toBe(true)
    store.undo()
    await flush()
    expect(store.nodes[id].layout.constraints).toEqual({ h: 'left', v: 'top' })
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
