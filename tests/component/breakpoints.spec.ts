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

describe('M3 响应式断点：覆盖只写在活动断点上', () => {
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

  function addText(): string {
    const id = store.insertComponent('text', { position: { x: 20, y: 30 } })
    store.updateNode(id, { props: { text: '标题' }, style: { fontSize: 14 } })
    return id
  }

  it('基准断点上的编辑照旧写节点本身', () => {
    const id = addText()
    expect(store.isBaseBreakpoint).toBe(true)
    store.updateNode(id, { style: { fontSize: 18 } })
    expect(store.nodes[id].style.fontSize).toBe(18)
    expect(store.nodes[id].overrides).toEqual({})
  })

  it('手机断点改样式只写 override，基准与画布上都是断点有效值', () => {
    const id = addText()
    store.setBreakpoint('mobile')
    expect(store.isBaseBreakpoint).toBe(false)
    store.updateNode(id, { style: { fontSize: 22 } })
    expect(store.nodes[id].style.fontSize).toBe(14)
    expect(store.nodes[id].overrides.mobile?.style).toEqual({ fontSize: 22 })
    expect(store.selection[0]?.style.fontSize).toBe(22)
    store.setBreakpoint('desktop')
    expect(store.selection[0]?.style.fontSize).toBe(14)
  })

  it('改回继承值就让覆盖消失（覆盖只存差异）', () => {
    const id = addText()
    store.setBreakpoint('mobile')
    store.updateNode(id, { style: { fontSize: 22 } })
    store.updateNode(id, { style: { fontSize: 14 } })
    expect(store.nodes[id].overrides.mobile).toBeUndefined()
  })

  it('布局面板与画布拖动在窄断点也写 override，基准分毫不动', () => {
    const id = addText()
    const basePosition = { ...store.nodes[id].layout.position }
    store.setBreakpoint('mobile')
    store.updateLayout(id, { mode: 'vertical' })
    store.setBox(id, { x: 60, y: 90, w: 120, h: 40 }, '拖动')
    expect(store.nodes[id].layout.mode).toBe('free')
    expect(store.nodes[id].layout.position).toEqual(basePosition)
    expect(store.nodes[id].overrides.mobile?.layout?.mode).toBe('vertical')
    expect(store.nodes[id].overrides.mobile?.layout?.position).toEqual({ x: 60, y: 90 })
  })

  it('清除覆盖按钮把活动断点的覆盖删掉，而且可以撤销', () => {
    const id = addText()
    store.setBreakpoint('mobile')
    store.updateNode(id, { style: { fontSize: 22 } })
    store.select(id)
    expect(store.activeOverrideFlags.empty).toBe(false)
    store.clearOverrides()
    expect(store.nodes[id].overrides.mobile).toBeUndefined()
    expect(store.selection[0]?.style.fontSize).toBe(14)
    store.undo()
    expect(store.nodes[id].overrides.mobile?.style).toEqual({ fontSize: 22 })
  })

  it('属性面板显示覆盖标记，点清除按钮后消失', async () => {
    const id = addText()
    store.setBreakpoint('mobile')
    store.select(id)
    await nextTick()
    expect(wrapper.find('[data-role="override-badge"]').exists()).toBe(false)
    store.updateNode(id, { style: { fontSize: 22 } })
    await nextTick()
    expect(wrapper.find('[data-role="override-badge"]').exists()).toBe(true)
    await wrapper.find('[data-role="clear-override"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-role="override-badge"]').exists()).toBe(false)
    expect(store.nodes[id].overrides.mobile).toBeUndefined()
  })

  it('切换断点会同步画布宽度，并且不进历史（可以照常撤销上一次编辑）', async () => {
    const id = addText()
    const before = store.position
    store.setBreakpoint('mobile')
    expect(store.viewport().w).toBe(375)
    await nextTick()
    expect(wrapper.find('.canvas-page').attributes('style')).toContain('width: 375px')
    expect(store.position).toBe(before)
    store.updateNode(id, { style: { fontSize: 22 } })
    expect(store.position).toBe(before + 1)
  })

  it('画布渲染断点有效值：窄断点隐藏与样式覆盖都看得见，基准不变', async () => {
    const id = addText()
    await nextTick()
    const at = (): ReturnType<typeof wrapper.find> => wrapper.find(`.canvas-el[data-node-id="${id}"]`)
    expect(at().exists()).toBe(true)
    expect(at().classes()).not.toContain('canvas-el--hidden')
    store.setBreakpoint('mobile')
    store.updateNode(id, { meta: { hidden: true } })
    store.updateNode(id, { style: { bg: '#ff0000' } })
    await nextTick()
    // 编辑器里隐藏元素保留在画布上（半透明），导出时才 display:none
    expect(at().classes()).toContain('canvas-el--hidden')
    expect(store.nodes[id].meta.hidden).toBe(false)
    expect(store.nodes[id].style.bg).toBe('')
    store.updateNode(id, { meta: { hidden: false } })
    await nextTick()
    expect(at().classes()).not.toContain('canvas-el--hidden')
    // jsdom 会把颜色规范成 rgb()，所以断言规范化后的值
    expect(at().attributes('style')).toContain('background: rgb(255, 0, 0)')
    expect(store.resolvedNodes[id].style.bg).toBe('#ff0000')
  })

  it('PLAN 验收：桌面 3 列 → 手机 1 列，基准与断点互不污染', async () => {
    const grid = store.insertComponent('group', { position: { x: 0, y: 0 } })
    store.updateLayout(grid, {
      mode: 'grid',
      columns: 3,
      gap: 10,
      size: { w: { kind: 'fixed', value: 300 }, h: { kind: 'fixed', value: 120 } },
    })
    const cells = ['一', '二', '三'].map((label) => {
      const id = store.insertComponent('rect', { parentId: grid, position: { x: 0, y: 0 } })
      store.updateNode(id, { props: { text: label } })
      store.updateLayout(id, {
        size: { w: { kind: 'fill', value: 0 }, h: { kind: 'fixed', value: 50 } },
      })
      return id
    })
    const rowOf = (): number[] => cells.map((id) => store.boxes[id].y)
    const columnOf = (): number[] => cells.map((id) => store.boxes[id].x)
    expect(new Set(rowOf()).size).toBe(1) // 桌面：三列同一行
    expect(new Set(columnOf()).size).toBe(3)

    store.setBreakpoint('mobile')
    store.updateLayout(grid, { columns: 1 })
    await nextTick()

    expect(store.nodes[grid].layout.columns).toBe(3) // 基准没被污染
    expect(store.nodes[grid].overrides.mobile?.layout?.columns).toBe(1)
    expect(new Set(rowOf()).size).toBe(3) // 手机：一列三行
    expect(new Set(columnOf()).size).toBe(1)
    expect(store.generatedCss).toContain('@media (max-width: 767.98px)')
    // M5：类选择器靠顺序覆盖，不再用 !important
    expect(store.generatedCss).toContain('.n-')
    expect(store.generatedCss).not.toContain('!important')

    store.setBreakpoint('desktop')
    expect(store.nodes[grid].layout.columns).toBe(3)
    expect(new Set(rowOf()).size).toBe(1)
  })

  it('代码面板的 CSS 页签给出媒体查询', async () => {
    const id = addText()
    store.setBreakpoint('mobile')
    store.updateNode(id, { style: { fontSize: 22 } })
    await nextTick()
    expect(store.generatedCss).toContain('@media (max-width: 767.98px)')
    await wrapper.find('[data-role="tab-css"]').trigger('click')
    expect(wrapper.find('[data-role="code-view"]').text()).toContain('@media')
  })
})
