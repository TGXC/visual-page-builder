import { describe, expect, it } from 'vitest'
import {
  COMPONENT_CATEGORIES,
  componentProps,
  componentSize,
  componentStyle,
  componentTypes,
  componentsByCategory,
  getComponent,
  hasComponent,
  isContainerType,
  listComponents,
  registerComponent,
  renderCanvasContent,
  renderContent,
  searchComponents,
  unregisterComponent,
  type ComponentDescriptor,
} from '@/core/components'
import {
  COMPONENT_TYPE_SET,
  CONTENT_KEYS,
  DEFAULT_STYLE,
  STYLE_KEYS,
  V1_DEFAULTS,
  V1_DEF_SIZE,
  V1_TYPES,
} from '@/core/schema/catalog'
import { normalizeType } from '@/core/schema/normalize'
import { generateHtml } from '@/core/codegen'
import { createNode } from '@/core/ops'
import { defaultSizeFor } from '@/core/schema/catalog'
import { makeDoc, makeNode, makeNodes, makePage, docWithNodes } from './factories'

// M7 起组件库多了 'custom'（「我的组件」，AI 生成的自定义组件归档在这里）
const CATEGORY_IDS = ['layout', 'basic', 'form', 'media', 'display', 'custom']

describe('组件描述符注册表', () => {
  it('内置组件库至少 30 个，每个描述符字段完整', () => {
    const list = listComponents()
    expect(list.length).toBeGreaterThanOrEqual(30)
    for (const descriptor of list) {
      expect(descriptor.type).toBeTruthy()
      expect(descriptor.label).toBeTruthy()
      expect(CATEGORY_IDS).toContain(descriptor.category)
      expect(descriptor.icon).toBeTruthy()
      expect(descriptor.defaultSize.w).toBeGreaterThan(0)
      expect(descriptor.defaultSize.h).toBeGreaterThan(0)
      expect(typeof descriptor.toHtml).toBe('function')
      expect(descriptor.aiDoc.length).toBeGreaterThan(4)
      expect(Array.isArray(descriptor.overridable)).toBe(true)
      expect(typeof descriptor.container).toBe('boolean')
      expect(typeof descriptor.editable).toBe('boolean')
    }
  })

  it('每个内置类型都能按 type 查到，且没有重复注册', () => {
    const types = componentTypes()
    expect(new Set(types).size).toBe(types.length)
    for (const type of types) {
      expect(getComponent(type)?.type).toBe(type)
      expect(hasComponent(type)).toBe(true)
    }
    expect(getComponent('does-not-exist')).toBeUndefined()
    expect(hasComponent('does-not-exist')).toBe(false)
  })

  it('分类齐全且条目数与组件库一致', () => {
    const groups = componentsByCategory()
    expect(groups.map((group) => group.category)).toEqual(CATEGORY_IDS)
    expect(groups.every((group) => group.label.length > 0)).toBe(true)
    const total = groups.reduce((sum, group) => sum + group.items.length, 0)
    expect(total).toBe(listComponents().length)
    for (const group of groups) {
      expect(group.items.every((item) => item.category === group.category)).toBe(true)
    }
    expect(COMPONENT_CATEGORIES.length).toBe(CATEGORY_IDS.length)
  })

  it('搜索：按中文名、按 type、按分类、大小写不敏感，空查询返回全部', () => {
    expect(searchComponents('按钮').map((item) => item.type)).toContain('button')
    expect(searchComponents('input').map((item) => item.type)).toContain('input')
    expect(searchComponents('INPUT').map((item) => item.type)).toContain('input')
    expect(searchComponents('表单').every((item) => item.category === 'form')).toBe(true)
    expect(searchComponents('表单').length).toBeGreaterThan(3)
    expect(searchComponents('').length).toBe(listComponents().length)
    expect(searchComponents('  ').length).toBe(listComponents().length)
    expect(searchComponents('绝不存在的东西')).toEqual([])
  })

  it('容器与可编辑标记正确', () => {
    for (const type of ['frame', 'group', 'section', 'container', 'form']) {
      expect(isContainerType(type)).toBe(true)
    }
    for (const type of ['text', 'rect', 'button', 'input']) {
      expect(isContainerType(type)).toBe(false)
    }
    expect(isContainerType('does-not-exist')).toBe(false)
    for (const type of ['text', 'button', 'header', 'card', 'link', 'badge']) {
      expect(getComponent(type)?.editable).toBe(true)
    }
    expect(getComponent('image')?.editable).toBe(false)
  })

  it('十五类 v1 组件的默认值与迁移表保持一致（防默认值漂移）', () => {
    for (const type of V1_TYPES) {
      const descriptor = getComponent(type)
      expect(descriptor).toBeDefined()
      const expectedStyle: Record<string, unknown> = {}
      const expectedProps: Record<string, unknown> = {}
      for (const key of STYLE_KEYS) {
        const value = V1_DEFAULTS[type]?.[key]
        if (value !== undefined && value !== (DEFAULT_STYLE as unknown as Record<string, unknown>)[key]) {
          expectedStyle[key] = value
        }
      }
      for (const key of CONTENT_KEYS) {
        if (V1_DEFAULTS[type]?.[key] !== undefined) expectedProps[key] = V1_DEFAULTS[type][key]
      }
      expect(descriptor?.defaultStyle).toMatchObject(expectedStyle)
      expect(descriptor?.defaultProps).toMatchObject(expectedProps)
      expect(descriptor?.defaultSize).toEqual({ w: V1_DEF_SIZE[type][0], h: V1_DEF_SIZE[type][1] })
    }
  })

  it('默认值解析：描述符优先，未知类型回落到 catalog 表', () => {
    expect(componentSize('switch')).toEqual(getComponent('switch')?.defaultSize)
    expect(componentSize('text')).toEqual(defaultSizeFor('text'))
    expect(componentSize('unknown-type')).toEqual(defaultSizeFor('unknown-type'))
    expect(componentProps('video')).toMatchObject({ text: V1_DEFAULTS.video.text })
    expect(componentStyle('circle').bg).toBe(V1_DEFAULTS.circle.bg)
    expect(componentStyle('unknown-type')).toEqual(DEFAULT_STYLE)
  })

  it('normalizeType 接受注册过的第三方类型，未注册的回落 rect', () => {
    expect(normalizeType('switch')).toBe('switch')
    expect(normalizeType('my-widget')).toBe('rect')
    registerComponent(fakeWidget())
    try {
      expect(normalizeType('my-widget')).toBe('my-widget')
      expect(COMPONENT_TYPE_SET.has('my-widget')).toBe(true)
      expect(componentTypes()).toContain('my-widget')
    } finally {
      unregisterComponent('my-widget')
    }
    expect(normalizeType('my-widget')).toBe('rect')
  })
})

function render(node = makeNode({ id: 'n1', type: 'text', props: { text: '你好' } })) {
  const nodes = { n1: node }
  return renderContent(node, nodes)
}

function canvas(node = makeNode({ id: 'n1', type: 'text', props: { text: '你好' } })) {
  const nodes = { n1: node }
  return renderCanvasContent(node, nodes)
}

function fakeWidget(): ComponentDescriptor {
  return {
    type: 'my-widget',
    label: '第三方挂件',
    category: 'display',
    icon: '★',
    container: false,
    editable: false,
    defaultSize: { w: 120, h: 60 },
    defaultStyle: { bg: '#0f172a', color: '#ffffff' },
    defaultProps: { text: '挂件' },
    toHtml: (ctx) => `<span class="widget">${ctx.label}</span>`,
    toCanvasHtml: (ctx) => `<span class="widget">${ctx.label}</span>`,
    aiDoc: '第三方挂件：一个用于测试插件注册的假组件。',
    overridable: ['text'],
  }
}

describe('组件内容渲染（导出）', () => {
  it('文本与按钮：转义 HTML，标题型输出 sub', () => {
    expect(render(makeNode({ id: 'n1', type: 'text', props: { text: '<b>粗</b>' } }))).toBe('&lt;b&gt;粗&lt;/b&gt;')
    expect(render(makeNode({ id: 'n1', type: 'button', props: { text: '提交' } }))).toBe('提交')
    expect(
      render(makeNode({ id: 'n1', type: 'card', props: { text: '标题', sub: '描述' } })),
    ).toBe('标题<div class="sub">描述</div>')
  })

  it('表单控件：input/textarea 用 placeholder，select 输出选项，checkbox/radio 输出 label+input', () => {
    expect(render(makeNode({ id: 'n1', type: 'input', props: { placeholder: '请输入<' } }))).toBe(
      '<input type="text" placeholder="请输入&lt;">',
    )
    expect(render(makeNode({ id: 'n1', type: 'textarea', props: { placeholder: '内容' } }))).toBe(
      '<textarea placeholder="内容"></textarea>',
    )
    const select = render(
      makeNode({ id: 'n1', type: 'select', props: { text: '一, 二', placeholder: '请选择' } }),
    )
    expect(select).toBe(
      '<select><option value="">请选择</option><option>一</option><option>二</option></select>',
    )
    expect(render(makeNode({ id: 'n1', type: 'checkbox', props: { text: '甲,乙' } }))).toBe(
      '<label><input type="checkbox">甲</label><label><input type="checkbox">乙</label>',
    )
    expect(render(makeNode({ id: 'n1', type: 'radio', props: { text: '甲' } }))).toBe(
      '<label><input type="radio">甲</label>',
    )
  })

  it('媒体：image 有 src 时返回空（走背景图），video 有 src 时输出 video 标签', () => {
    expect(render(makeNode({ id: 'n1', type: 'image', props: { text: '🖼️', src: 'a.png' } }))).toBe('')
    expect(render(makeNode({ id: 'n1', type: 'image', props: { text: '🖼️' } }))).toBe('🖼️')
    expect(render(makeNode({ id: 'n1', type: 'video', props: { src: 'https://a/v.mp4' } }))).toBe(
      '<video src="https://a/v.mp4" controls></video>',
    )
    expect(render(makeNode({ id: 'n1', type: 'video', props: { src: 'javascript:alert(1)', text: '视频' } }))).toBe(
      '视频',
    )
    expect(render(makeNode({ id: 'n1', type: 'audio', props: { src: 'a.mp3' } }))).toContain('<audio')
  })

  it('分割线与间距不产生内容', () => {
    expect(render(makeNode({ id: 'n1', type: 'divider' }))).toBe('')
    expect(render(makeNode({ id: 'n1', type: 'spacer' }))).toBe('')
  })

  it('新增表单组件都能产出可导出的控件', () => {
    const cases: [string, string][] = [
      ['switch', 'role="switch"'],
      ['slider', 'type="range"'],
      ['date', 'type="date"'],
      ['number', 'type="number"'],
      ['file', 'type="file"'],
      ['rating', '★'],
      ['form', ''],
    ]
    for (const [type, needle] of cases) {
      const html = render(makeNode({ id: 'n1', type, props: { text: '标签' } }))
      expect(html).toContain(needle)
    }
  })

  it('新增展示组件：list/table/tabs/alert/progress/avatar/icon/badge/heading/label/link', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['list', { text: '一,二,三' }, '<ul'],
      ['table', { text: '名称,数量', sub: '苹果,3;香蕉,5' }, '<table'],
      ['tabs', { text: '概览,详情' }, 'role="tab"'],
      ['alert', { text: '注意' }, 'role="alert"'],
      ['progress', { text: '进度', sub: '60' }, '<progress'],
      ['avatar', { text: 'Ada' }, 'A'],
      ['icon', { text: '★' }, '★'],
      ['badge', { text: '徽章' }, '徽章'],
      ['heading', { text: '标题' }, '标题'],
      ['label', { text: '标签' }, '标签'],
      ['link', { text: '去这里' }, '<a '],
    ]
    for (const [type, props, needle] of cases) {
      const html = render(makeNode({ id: 'n1', type, props }))
      expect(html, `${type} 的导出内容应包含 ${needle}`).toContain(needle)
    }
  })

  it('第三方注册的组件能被导出与搜索到', () => {
    registerComponent(fakeWidget())
    try {
      const root = makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 })
      const node = makeNode({ id: 'w1', type: 'my-widget', props: { text: '挂件' }, parentId: 'root', order: 0 })
      const page = makePage({ id: 'p1', root: 'root', nodes: makeNodes([root, node]) })
      const doc = makeDoc({ pages: [page], activePageId: 'p1' })
      const html = generateHtml(doc, 'p1')
      expect(html).toContain('<span class="widget">挂件</span>')
      expect(html).toContain('el--my-widget')
      expect(searchComponents('widget').map((item) => item.type)).toContain('my-widget')
    } finally {
      unregisterComponent('my-widget')
    }
  })

  it('重复注册同一 type 会覆盖旧描述符（插件热插拔）', () => {
    registerComponent(fakeWidget())
    registerComponent({ ...fakeWidget(), label: '挂件 v2', icon: '☆' })
    try {
      expect(listComponents().filter((item) => item.type === 'my-widget').length).toBe(1)
      expect(getComponent('my-widget')?.label).toBe('挂件 v2')
    } finally {
      unregisterComponent('my-widget')
    }
  })
})

describe('组件内容渲染（画布）', () => {
  it('画布沿用编辑器类名，空容器给出提示', () => {
    expect(canvas(makeNode({ id: 'n1', type: 'text', props: { text: '文字' } }))).toContain('文字')
    expect(canvas(makeNode({ id: 'n1', type: 'frame' }))).toContain('canvas-el__frame-hint')
    expect(canvas(makeNode({ id: 'n1', type: 'group' }))).toContain('空分组')
    expect(canvas(makeNode({ id: 'n1', type: 'section' }))).toContain('canvas-el__muted')
    expect(canvas(makeNode({ id: 'n1', type: 'image', props: { text: '🖼️' } }))).toContain('canvas-el__muted')
    expect(canvas(makeNode({ id: 'n1', type: 'video' }))).toContain('canvas-el__play')
    expect(canvas(makeNode({ id: 'n1', type: 'select' }))).toContain('canvas-el__caret')
    expect(canvas(makeNode({ id: 'n1', type: 'radio', props: { text: '甲,乙' } }))).toContain('canvas-el__dot')
    expect(canvas(makeNode({ id: 'n1', type: 'checkbox', props: { text: '甲' } }))).toContain('canvas-el__box')
    expect(canvas(makeNode({ id: 'n1', type: 'card', props: { text: '标题', sub: '描述' } }))).toContain(
      'canvas-el__title',
    )
  })

  it('容器有子节点时不再显示空态提示', () => {
    const child = makeNode({ id: 'c1', type: 'text', parentId: 'n1', order: 0 })
    const container = makeNode({ id: 'n1', type: 'group' })
    const nodes = { n1: container, c1: child }
    expect(renderCanvasContent(container, nodes)).not.toContain('空分组')
    expect(renderCanvasContent(makeNode({ id: 'n2', type: 'group' }), { n2: makeNode({ id: 'n2', type: 'group' }) })).toContain('空分组')
  })
})

describe('文档级默认值解析', () => {
  it('新增类型用描述符默认值建节点，未知类型回落到 rect 的默认值', () => {
    const node = createNode('switch', { parentId: 'root', order: 0 })
    expect(node.type).toBe('switch')
    expect(node.layout.size.w.value).toBe(getComponent('switch')?.defaultSize.w)
    expect(node.layout.size.h.value).toBe(getComponent('switch')?.defaultSize.h)
    expect(node.props.text).toBe('开关')
    expect(node.style.bg).toBe('')

    const unknown = createNode('nope', { parentId: 'root', order: 1 })
    expect(unknown.layout.size.w.value).toBe(defaultSizeFor('nope').w)
    expect(docWithNodes([unknown]).pages[0].nodes[unknown.id].type).toBe('nope')
  })
})
