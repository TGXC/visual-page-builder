import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DSL_MAX_DEPTH,
  DSL_MAX_NODES,
  type ComponentDsl,
  compileDsl,
  customTypeOf,
  validateDsl,
} from '@/core/dsl'
import { CUSTOM_DSL_KEY, loadCustomDsl, saveCustomDsl } from '@/core/persistence/custom'
import {
  getComponent,
  hasComponent,
  listComponents,
  registerComponent,
  unregisterComponent,
} from '@/core/components'
import { generateBodyHtml, generatePageCss } from '@/core/codegen'
import { makeNode, makePage, makeDoc } from './factories'

function dsl(partial: Partial<ComponentDsl> = {}): ComponentDsl {
  return {
    name: '团队成员卡片',
    size: { w: 220, h: 120 },
    props: [
      { key: 'title', label: '姓名', type: 'text', default: '张三' },
      { key: 'sub', label: '职位', type: 'text', default: '前端工程师' },
    ],
    root: {
      type: 'card',
      style: { bg: '#FFFFFF', radius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 },
      children: [
        { type: 'heading', text: '{{title}}', style: { fontSize: 16, fontWeight: 700, color: '#0F172A' } },
        { type: 'text', text: '{{sub}}', style: { fontSize: 13, color: '#64748B' } },
      ],
    },
    ...partial,
  }
}

const registered: string[] = []

function register(draft: ComponentDsl = dsl()) {
  const descriptor = compileDsl(draft)
  registerComponent(descriptor)
  registered.push(descriptor.type)
  return descriptor
}

afterEach(() => {
  while (registered.length > 0) unregisterComponent(registered.pop()!)
  localStorage.clear()
})

describe('M7 自定义组件受限 DSL（core/dsl，纯逻辑）', () => {
  it('合法 DSL 编译成组件描述符（类型/分类/默认值/AI 说明齐备）', () => {
    const descriptor = register()
    expect(descriptor.type).toBe(customTypeOf('团队成员卡片'))
    expect(descriptor.category).toBe('custom')
    expect(descriptor.label).toBe('团队成员卡片')
    expect(descriptor.container).toBe(false)
    expect(descriptor.hidden).toBeFalsy()
    expect(descriptor.defaultSize).toEqual({ w: 220, h: 120 })
    expect(descriptor.defaultProps).toEqual({ title: '张三', sub: '前端工程师' })
    expect(descriptor.overridable).toContain('title')
    expect(descriptor.aiDoc).toContain('我的组件')
    expect(typeof descriptor.toHtml).toBe('function')
    expect(typeof descriptor.cssFor).toBe('function')
  })

  it('校验拒绝越界内容：未注册类型 / 保留类型 / 太深 / 太多 / 键不在白名单 / 值可疑', () => {
    const bad = (patch: Partial<ComponentDsl>): string =>
      validateDsl(dsl(patch)).map((problem) => problem.message).join('｜')
    expect(bad({ root: { type: 'no-such-type' } })).toContain('未注册')
    expect(bad({ root: { type: 'instance' } })).toContain('未注册')
    expect(bad({ name: '' })).toContain('名字')
    expect(bad({ name: 'x'.repeat(30) })).toContain('名字')
    // 深度超限
    let deep: ComponentDsl['root'] = { type: 'text', text: '叶子' }
    for (let level = 0; level < DSL_MAX_DEPTH + 1; level += 1) deep = { type: 'container', children: [deep] }
    expect(validateDsl(dsl({ root: deep })).length).toBeGreaterThan(0)
    // 节点数超限
    const wide = {
      type: 'container',
      children: Array.from({ length: DSL_MAX_NODES + 2 }, () => ({ type: 'text', text: '项' })),
    }
    expect(bad({ root: wide })).toContain('节点')
    // 样式键与值：白名单外、url()、脚本串、NaN
    expect(bad({ root: { type: 'text', style: { backgroundImage: 'url(x.png)' } } as never })).toContain('样式')
    expect(bad({ root: { type: 'text', style: { bg: 'url(javascript:alert(1))' } } })).toContain('颜色')
    expect(bad({ root: { type: 'text', style: { bg: 'red;background:url(x)' } } })).toContain('颜色')
    expect(bad({ root: { type: 'text', style: { fontSize: Number.NaN } } })).toContain('数值')
    expect(bad({ root: { type: 'text', style: { display: 'block;position:fixed' } } })).toContain('display')
    // 占位符必须对应声明的 prop
    expect(bad({ root: { type: 'text', text: '{{nope}}' } })).toContain('prop')
    // prop 声明本身
    expect(bad({ props: [{ key: 'a b', label: 'x', type: 'text', default: '' }] })).toContain('prop')
    expect(bad({ root: { type: 'text', text: 'x'.repeat(200) } })).toContain('文字')
  })

  it('toHtml 转义文本、按 props 替换占位符（缺省回落默认值）', () => {
    const descriptor = register()
    const html = descriptor.toHtml({
      node: makeNode({
        id: 'c1',
        type: descriptor.type,
        props: { title: '<img src=x onerror=alert(1)>', sub: '设计师' },
      }),
      nodes: {},
      children: [],
      label: '',
      sub: '',
      placeholder: '',
      src: '',
      link: '',
      options: [],
      customText: false,
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).toContain('设计师')
    expect(html).toMatch(/cc-[a-z0-9-]+/)
  })

  it('cssFor(scope) 的规则全部带作用域前缀，且不含 url() / 脚本', () => {
    const descriptor = register()
    const css = descriptor.cssFor!('.n-c1')
    expect(css).toContain('.n-c1 .cc-')
    expect(css).toContain('border-radius:12px')
    expect(css).toContain('padding:16px')
    expect(css).toContain('display:flex')
    expect(css).not.toContain('url(')
    expect(css).not.toContain('javascript:')
    for (const line of css.split('\n').filter((row) => row.includes('{'))) {
      expect(line.trim().startsWith('.n-c1 .cc-')).toBe(true)
    }
  })

  it('注册后导出：正文无内联样式，样式表带上该组件的作用域规则', () => {
    const descriptor = register()
    const page = makePage({
      id: 'page_1',
      nodes: {
        root: makeNode({ id: 'root', type: 'frame' }),
        c1: makeNode({ id: 'c1', type: descriptor.type, parentId: 'root' }),
      },
    })
    const doc = makeDoc({ pages: [page], activePageId: 'page_1' })
    const body = generateBodyHtml(doc, 'page_1')
    const css = generatePageCss(doc, 'page_1')
    expect(body).toContain('class="el el--' + descriptor.type + ' n-c1"')
    expect(body).not.toContain('style="')
    expect(css).toContain('.n-c1 .cc-')
    expect(css).toContain('padding:16px')
  })

  it('注册表可查询、可卸载，且出现在组件面板清单里', () => {
    const descriptor = register()
    expect(hasComponent(descriptor.type)).toBe(true)
    expect(getComponent(descriptor.type)?.label).toBe('团队成员卡片')
    expect(listComponents().some((item) => item.type === descriptor.type)).toBe(true)
    expect(unregisterComponent(descriptor.type)).toBe(true)
    expect(hasComponent(descriptor.type)).toBe(false)
  })

  it('DSL 存档 round-trip：坏 JSON / 非数组一律回落空表，写失败不抛', () => {
    expect(loadCustomDsl()).toEqual([])
    expect(saveCustomDsl([dsl()])).toBe(true)
    expect(loadCustomDsl().length).toBe(1)
    expect(loadCustomDsl()[0]!.name).toBe('团队成员卡片')
    localStorage.setItem(CUSTOM_DSL_KEY, '{oops')
    expect(loadCustomDsl()).toEqual([])
    localStorage.setItem(CUSTOM_DSL_KEY, '{"a":1}')
    expect(loadCustomDsl()).toEqual([])
    localStorage.removeItem(CUSTOM_DSL_KEY)
    expect(loadCustomDsl()).toEqual([])
  })

  it('存档读写被拒时静默降级（配额满 / localStorage 不可用）', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(saveCustomDsl([dsl()])).toBe(false)
    setItem.mockRestore()

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(loadCustomDsl()).toEqual([])
    getItem.mockRestore()

    // localStorage 这个属性本身抛错（隐私模式）：storage() 的 catch 分支
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied')
      },
    })
    expect(loadCustomDsl()).toEqual([])
    expect(saveCustomDsl([dsl()])).toBe(false)
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
  })

  it('校验覆盖 props / size / style / children / text 的坏形状', () => {
    const problems = (raw: unknown): string => validateDsl(raw).map((item) => item.message).join('｜')
    expect(problems('not-an-object')).toContain('DSL 必须是对象')
    expect(problems({ name: 'x', props: {} })).toContain('props 必须是数组')
    expect(
      problems({
        name: 'x',
        props: Array.from({ length: 9 }, (_item, index) => ({
          key: `p${index}`,
          label: 'x',
          type: 'text',
          default: '',
        })),
        root: { type: 'text' },
      }),
    ).toContain('props 最多')
    expect(problems({ name: 'x', props: [{ key: 'a', type: 'date', default: '' }], root: { type: 'text' } })).toContain(
      'text/number/color',
    )
    expect(problems({ name: 'x', size: { w: 'wide' }, root: { type: 'text' } })).toContain('size 必须是')
    expect(problems({ name: 'x', root: { type: 'text', style: 'red' } })).toContain('style 必须是对象')
    expect(problems({ name: 'x', root: { type: 'text', style: { fontSize: 'big' } } })).toContain('数值不合法')
    expect(problems({ name: 'x', root: { type: 'text', style: { fontSize: 9999 } } })).toContain('数值不合法')
    expect(problems({ name: 'x', root: { type: 'text', style: { display: 'grid' } } })).toContain('display 只能是')
    expect(problems({ name: 'x', root: { type: 'text', children: 'nope' } })).toContain('children 必须是数组')
    expect(problems({ name: 'x', root: { type: 'text', text: 42 } })).toContain('text 必须是字符串')
    expect(problems({ name: 'x', root: { type: 'text', children: ['nope'] } })).toContain('节点必须是对象')
    expect(problems({ name: 'x', root: { type: '' } })).toContain('未注册')
    expect(problems({ name: 'x' })).toContain('缺少 root')
  })

  it('渲染兜底：没有样式的节点不产规则，缺省 / 数字 prop 都能兜住', () => {
    const draft: ComponentDsl = {
      name: '纯文本卡片',
      props: [{ key: 'count', label: '数量', type: 'number', default: 3 }],
      root: { type: 'card', children: [{ type: 'text', text: '共 {{count}} 项' }, { type: 'text' }] },
    }
    const descriptor = compileDsl(draft)
    expect(descriptor.cssFor!('.n-x')).toBe('')
    const html = descriptor.toHtml({
      node: makeNode({ id: 'c2', type: descriptor.type, props: {} }),
      nodes: {},
      children: [],
      label: '',
      sub: '',
      placeholder: '',
      src: '',
      link: '',
      options: [],
      customText: false,
    })
    expect(html).toContain('共 3 项')
    const withValues = descriptor.toHtml({
      node: makeNode({ id: 'c2', type: descriptor.type, props: { count: 42 } }),
      nodes: {},
      children: [],
      label: '',
      sub: '',
      placeholder: '',
      src: '',
      link: '',
      options: [],
      customText: false,
    })
    expect(withValues).toContain('共 42 项')
  })
})
