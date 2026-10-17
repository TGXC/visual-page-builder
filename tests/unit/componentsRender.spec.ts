import { describe, expect, it } from 'vitest'
import {
  componentProps,
  componentSize,
  componentStyle,
  componentsByCategory,
  getComponent,
  hasComponent,
  isContainerType,
  isEditableType,
  listComponents,
  overridableKeys,
  registerComponent,
  registryRevision,
  renderCanvasContent,
  renderContent,
  searchComponents,
  subscribeRegistry,
  unregisterComponent,
} from '@/core/components'
import { makeNode } from './factories'
import { v1StyleFor } from '@/core/schema/v1'

/**
 * M4：把 40 个描述符的渲染分支跑满。
 *
 * 每个组件都拿三种输入渲染一遍：
 * ① 描述符默认 props（正常路径）；② 空 props（走 `||` / `??` 兜底）；
 * ③ 全量 props（含子标签、占位符、地址、选项），并且地址是 `javascript:`（走 `safeUrl` 拦截）。
 */
const FULL_PROPS: Record<string, unknown> = {
  text: '文案,一,二',
  sub: '副标题',
  placeholder: '请输入内容',
  src: 'javascript:alert(1)',
  link: 'javascript:alert(1)',
  symbolId: '',
}

function htmlOf(type: string, props: Record<string, unknown>): [string, string] {
  const node = makeNode({ id: `n_${type}`, type, props })
  const nodes = { [node.id]: node }
  return [renderContent(node, nodes), renderCanvasContent(node, nodes)]
}

describe('M4 组件渲染：全部描述符', () => {
  const descriptors = listComponents()

  it('40 个描述符都能渲染导出 HTML 与画布 HTML', () => {
    expect(descriptors).toHaveLength(40)
    for (const descriptor of descriptors) {
      const [html, canvas] = htmlOf(descriptor.type, { ...componentProps(descriptor.type) })
      expect(html, `${descriptor.type} 的导出 HTML 应为字符串`).toBeTypeOf('string')
      expect(canvas, `${descriptor.type} 的画布 HTML 应为字符串`).toBeTypeOf('string')
    }
  })

  it('空 props 时全部走兜底文案', () => {
    for (const descriptor of descriptors) {
      const [html, canvas] = htmlOf(descriptor.type, {})
      expect(html, `${descriptor.type} 空 props 仍应渲染`).toBeTypeOf('string')
      expect(html, `${descriptor.type} 空 props 不该渲染出 "undefined"`).not.toContain('undefined')
      expect(canvas, `${descriptor.type} 空 props 不该渲染出 "undefined"`).not.toContain('undefined')
    }
  })

  it('全量 props（含可执行地址）时渲染结果不含 javascript: 也不含 undefined', () => {
    for (const descriptor of descriptors) {
      const [html, canvas] = htmlOf(descriptor.type, { ...FULL_PROPS })
      expect(html, `${descriptor.type}`).not.toContain('javascript:')
      expect(html, `${descriptor.type}`).not.toContain('undefined')
      expect(canvas, `${descriptor.type}`).not.toContain('javascript:')
      expect(canvas, `${descriptor.type}`).not.toContain('undefined')
    }
  })

  it('未注册类型回落到纯文本渲染', () => {
    const [html, canvas] = htmlOf('no-such-type', { text: '裸文本' })
    expect(html).toBe('裸文本')
    expect(canvas).toBe('裸文本')
  })

  it('容器与可编辑标记来自描述符', () => {
    expect(isContainerType('frame')).toBe(true)
    expect(isContainerType('columns')).toBe(true)
    expect(isContainerType('rect')).toBe(false)
    expect(isContainerType('no-such-type')).toBe(false)
    expect(isEditableType('text')).toBe(true)
    expect(isEditableType('rect')).toBe(false)
    expect(isEditableType('no-such-type')).toBe(false)
  })
})

describe('M4 组件注册表：API 分支', () => {
  it('注册、查重、注销与订阅通知', () => {
    let notified = 0
    const unsubscribe = subscribeRegistry(() => {
      notified += 1
    })
    const before = registryRevision()

    const descriptor = getComponent('text')
    expect(descriptor).toBeDefined()
    const fake = { ...(descriptor as NonNullable<typeof descriptor>), type: 'branch-widget', label: '分支挂件' }
    registerComponent(fake)
    expect(registryRevision()).toBeGreaterThan(before)
    expect(hasComponent('branch-widget')).toBe(true)
    // 重复注册同一类型不会重复入列
    const count = listComponents().length
    registerComponent({ ...fake, label: '改名的分支挂件' })
    expect(listComponents()).toHaveLength(count)
    expect(getComponent('branch-widget')?.label).toBe('改名的分支挂件')

    expect(unregisterComponent('branch-widget')).toBe(true)
    expect(unregisterComponent('branch-widget')).toBe(false)
    expect(hasComponent('branch-widget')).toBe(false)

    unsubscribe()
    const afterUnsubscribe = registryRevision()
    registerComponent(fake)
    expect(registryRevision()).toBeGreaterThan(afterUnsubscribe)
    expect(notified).toBeGreaterThanOrEqual(3)
    unregisterComponent('branch-widget')
  })

  it('注册空 type 会报错，未知类型的默认值回落 v1', () => {
    expect(() => registerComponent({ ...(getComponent('rect') as NonNullable<ReturnType<typeof getComponent>>), type: '' })).toThrow()
    expect(getComponent('no-such-type')).toBeUndefined()
    expect(componentSize('no-such-type')).toEqual({ w: 160, h: 60 })
    // 未注册类型回落到 v1 表：v1 表里也没有 'no-such-type'，于是拿的是 DEFAULT_STYLE
    expect(componentStyle('no-such-type')).toEqual(v1StyleFor('no-such-type'))
    expect(componentStyle('no-such-type').bg).toBe('')
    expect(componentProps('no-such-type')).toEqual({})
    expect(overridableKeys('text')).toEqual(['text', 'color', 'fontSize', 'bg'])
  })

  it('分类与搜索覆盖空查询、无结果、第三方组件', () => {
    expect(componentsByCategory().map((group) => group.category)).toEqual([
      'layout',
      'basic',
      'form',
      'media',
      'display',
      'custom',
    ])
    expect(searchComponents('')).toHaveLength(listComponents().length)
    expect(searchComponents('绝不存在的东西')).toEqual([])
    const descriptor = getComponent('rect') as NonNullable<ReturnType<typeof getComponent>>
    registerComponent({ ...descriptor, type: 'search-widget', label: '可搜索挂件', aiDoc: '第三方搜索挂件' })
    expect(searchComponents('search-widget').map((item) => item.type)).toContain('search-widget')
    expect(searchComponents('可搜索挂件').map((item) => item.type)).toContain('search-widget')
    expect(searchComponents('第三方搜索').map((item) => item.type)).toContain('search-widget')
    unregisterComponent('search-widget')
  })
})
