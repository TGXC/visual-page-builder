import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import type { EditorStore } from '@/stores/editor'
import { useEditorStore } from '@/stores/editor'
import { dropOn, installLayout } from './helpers'

function mountShell(): { wrapper: VueWrapper; store: EditorStore } {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useEditorStore()
  store.newProject()
  const wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, store }
}

function stubDownload(): string[] {
  const created: string[] = []
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      created.push(blob.type)
      return 'blob:studio'
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  return created
}

describe('M1 产出：代码面板、导出、模板与导入', () => {
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

  it('代码面板展示 HTML，切到 CSS 页签显示内联说明与断点覆盖', async () => {
    const id = store.insertComponent('text', { position: { x: 20, y: 30 } })
    store.updateNode(id, { props: { text: '欢迎光临' } })
    await nextTick()
    const view = wrapper.find('[data-role="code-view"]')
    expect(view.text()).toContain('<!DOCTYPE html>')
    expect(view.text()).toContain('欢迎光临')
    expect(view.text()).toContain('position:absolute')
    await wrapper.find('[data-role="tab-css"]').trigger('click')
    const css = wrapper.find('[data-role="code-view"]').text()
    expect(css).toContain('内联')
    expect(css).toContain('@media (max-width: 1199.98px)')
  })

  it('复制代码写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await wrapper.find('[data-role="copy-code"]').trigger('click')
    await nextTick()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'))
    expect(wrapper.find('[data-role="code-toast"]').text()).toContain('已复制')
  })

  it('下载 HTML 生成 Blob 并触发下载', async () => {
    const created = stubDownload()
    await wrapper.find('[data-role="download-code"]').trigger('click')
    expect(created).toEqual(['text/html;charset=utf-8'])
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('导出项目 JSON 也走下载', async () => {
    const created = stubDownload()
    await wrapper.find('[data-role="export-json"]').trigger('click')
    expect(created).toEqual(['application/json'])
  })

  it('新窗口预览把生成的 HTML 写进新窗口', async () => {
    const write = vi.fn()
    const win = { document: { write, close: vi.fn() } }
    vi.spyOn(window, 'open').mockReturnValue(win as never)
    await wrapper.find('[data-role="preview-code"]').trigger('click')
    expect(write).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'))
  })

  it('导出 PNG：用 2D 上下文绘制并触发下载（jsdom 无真实 canvas）', async () => {
    const calls: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textBaseline: '',
      fillRect: () => calls.push('fillRect'),
      fillText: (text: string) => calls.push(`fillText:${text}`),
      strokeRect: () => calls.push('strokeRect'),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA')
    stubDownload()
    const id = store.insertComponent('text', { position: { x: 10, y: 10 } })
    store.updateNode(id, { props: { text: '截图文案' } })
    await wrapper.find('[data-role="export-png"]').trigger('click')
    expect(calls).toContain('fillRect')
    expect(calls.some((item) => item.startsWith('fillText:'))).toBe(true)
    expect(wrapper.text()).toContain('已导出 PNG')
  })

  it('载入模板替换整份文档', async () => {
    await wrapper.find('.template-item[data-template="login"]').trigger('click')
    await nextTick()
    expect(Object.keys(store.nodes).length).toBeGreaterThan(3)
    expect(store.pages).toHaveLength(1)
    expect(wrapper.findAll('.canvas-el').length).toBeGreaterThan(1)
  })

  it('通过文件导入 v2 文档', async () => {
    const doc = JSON.parse(JSON.stringify(store.doc))
    doc.name = '导入的站点'
    const file = new File([JSON.stringify(doc)], 'site.json', { type: 'application/json' })
    const input = wrapper.find('[data-role="import-file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(store.doc.name).toBe('导入的站点'))
    expect(wrapper.text()).toContain('已导入 v2 文档')
  })

  it('图片三通道：填地址画出背景图，清空后回落占位文案', async () => {
    const id = store.insertComponent('image', { position: { x: 10, y: 10 } })
    store.updateNode(id, { props: { src: 'https://example.com/a.png' } })
    await nextTick()
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"]`).attributes('style')).toContain('background-image')
    // 只发 src 这一个键不会抹掉图片自带的占位文案（style/props 浅合并）
    expect(store.nodes[id].props.text).toBe('🖼️')
    store.updateNode(id, { props: { src: '', text: '' } })
    await nextTick()
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"]`).attributes('style')).not.toContain('background-image')
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"] .canvas-el__muted`).text()).toBe('图片')
  })

  it('图片本地文件通道：选文件转成 dataURL 写入 src，且不动其它属性', async () => {
    const id = store.insertComponent('image', { position: { x: 10, y: 10 } })
    store.select(id)
    await nextTick()
    const input = wrapper.find('[data-role="image-file"]')
    expect(input.exists()).toBe(true)
    const file = new File(['fake-bytes'], 'a.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(store.nodes[id].props.src).toMatch(/^data:image\/png;base64,/))
    expect(store.nodes[id].props.text).toBe('🖼️')
    expect(wrapper.find(`.canvas-el[data-node-id="${id}"]`).attributes('style')).toContain('background-image')
  })

  it('拖入分组：落点在分组内则成为子节点', async () => {
    const groupId = store.insertComponent('group', { position: { x: 100, y: 100 } })
    store.setSize(groupId, 400, 300, 'init')
    dropOn(wrapper.find('.canvas-stage').element, 'text', 200, 200)
    await nextTick()
    const child = Object.values(store.nodes).find((node) => node.type === 'text')
    expect(child?.parentId).toBe(groupId)
    expect(wrapper.find(`.canvas-el[data-node-id="${groupId}"] .canvas-el[data-node-id="${child?.id}"]`).exists()).toBe(true)
  })

  it('双击画布元素改文字', async () => {
    const id = store.insertComponent('text', { position: { x: 10, y: 10 } })
    store.updateNode(id, { props: { text: '原标题' } })
    await nextTick()
    await wrapper.find(`.canvas-el[data-node-id="${id}"]`).trigger('dblclick')
    const editor = wrapper.find('[data-role="text-editor"]')
    expect(editor.exists()).toBe(true)
    await editor.setValue('改后的标题')
    await editor.trigger('keydown.enter')
    expect(store.nodes[id].props.text).toBe('改后的标题')
  })
})
