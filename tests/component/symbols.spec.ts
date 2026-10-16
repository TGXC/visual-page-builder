import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import { registerComponent, unregisterComponent } from '@/core/components'
import type { ComponentDescriptor } from '@/core/components'
import type { EditorStore } from '@/stores/editor'
import { useEditorStore } from '@/stores/editor'
import { down, dropOn, installLayout } from './helpers'

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

function fakeWidget(): ComponentDescriptor {
  return {
    type: 'my-widget',
    label: '第三方挂件',
    category: 'display',
    icon: '★',
    container: false,
    editable: false,
    defaultSize: { w: 200, h: 80 },
    defaultStyle: { bg: '#0f172a', color: '#ffffff' },
    defaultProps: { text: '挂件' },
    toHtml: (ctx) => `<span class="widget">${ctx.label}</span>`,
    toCanvasHtml: (ctx) => `<span class="widget">${ctx.label}</span>`,
    aiDoc: '第三方挂件：用于测试插件注册的假组件。',
    overridable: ['text'],
  }
}

describe('M4 组件：master / instance', () => {
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

  function texts(): string[] {
    return wrapper.findAll('.canvas-el[data-type="text"] .canvas-el__inner').map((el) => el.text())
  }

  it('选区变成组件后，改 master 三个实例同步（且可撤销）', async () => {
    const textId = store.insertComponent('text')
    store.updateNode(textId, { props: { text: '原始文案' } })
    store.select(textId)
    await flush()

    const symbolId = store.createComponent('文案组件')
    expect(symbolId).toBeTruthy()
    expect(store.symbols).toHaveLength(1)
    expect(store.symbols[0].name).toBe('文案组件')

    // 原节点被替换成一个实例
    const firstInstance = store.selectedIds[0]
    expect(store.nodes[firstInstance].type).toBe('instance')
    expect(store.nodes[textId]).toBeUndefined()

    store.insertInstance(symbolId as string)
    store.insertInstance(symbolId as string)
    await flush()

    expect(store.componentInstances(symbolId as string)).toHaveLength(3)
    expect(texts()).toEqual(['原始文案', '原始文案', '原始文案'])

    const masterRoot = store.doc.symbols?.[symbolId as string]?.root as string
    store.updateSymbolNode(symbolId as string, masterRoot, { props: { text: '改后的文案' } })
    await flush()
    expect(texts()).toEqual(['改后的文案', '改后的文案', '改后的文案'])

    store.undo()
    await flush()
    expect(texts()).toEqual(['原始文案', '原始文案', '原始文案'])
  })

  it('实例 props 只在白名单内生效', async () => {
    const textId = store.insertComponent('text')
    store.select(textId)
    const symbolId = store.createComponent('文案组件') as string
    const instanceId = store.selectedIds[0]
    store.updateNode(instanceId, { props: { text: '实例文案', sub: '不该生效' } })
    await flush()
    expect(texts()).toEqual(['实例文案'])
    const masterRoot = store.doc.symbols?.[symbolId]?.root as string
    // 白名单外的键不会写进 master
    expect(store.doc.symbols?.[symbolId]?.nodes[masterRoot].props.sub).toBeUndefined()
  })

  it('点中实例展开出来的子节点会选中实例本身', async () => {
    const textId = store.insertComponent('text')
    store.select(textId)
    store.createComponent('文案组件')
    const instanceId = store.selectedIds[0]
    await flush()

    const synthetic = wrapper.find('.canvas-el[data-type="instance"] .canvas-el[data-type="text"]')
    expect(synthetic.exists()).toBe(true)
    down(synthetic.element, 10, 10)
    expect(store.selectedIds).toEqual([instanceId])
  })

  it('第三方注册的组件立刻出现在面板、能拖进画布并进入导出 HTML', async () => {
    registerComponent(fakeWidget())
    try {
      await flush()
      expect(wrapper.find('.palette-item[data-type="my-widget"]').exists()).toBe(true)

      const stage = wrapper.find('.canvas-stage')
      dropOn(stage.element, 'my-widget', 120, 160)
      await flush()

      const node = Object.values(store.nodes).find((item) => item.type === 'my-widget')
      expect(node).toBeDefined()
      expect(store.generatedHtml).toContain('<span class="widget">挂件</span>')
      expect(store.generatedHtml).toContain('el--my-widget')
    } finally {
      unregisterComponent('my-widget')
    }
  })
})
