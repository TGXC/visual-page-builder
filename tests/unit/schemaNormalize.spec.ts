import { describe, expect, it } from 'vitest'
import {
  createDoc,
  createPage,
  createRootFrame,
  DEFAULT_STYLE,
  DEFAULT_THEME_TOKENS,
  DEFAULT_VIEWPORT,
  MAX_COORD,
  MAX_TEXT,
  normalizeBreakpoints,
  normalizeDoc,
  normalizeNode,
  normalizeNodes,
  normalizeSize,
  normalizeStyle,
  normalizeTheme,
  normalizeType,
} from '@/core/schema'
import type { Page } from '@/core/schema'

function rootOf(page: Page): string {
  return page.root
}

function rootsIn(page: Page): string[] {
  return Object.values(page.nodes)
    .filter((node) => node.parentId === null)
    .map((node) => node.id)
}

describe('createDoc / createPage / createRootFrame', () => {
  it('createDoc 给出 version 2 的单页文档，并指向该页', () => {
    const doc = createDoc()
    expect(doc.version).toBe(2)
    expect(doc.pages).toHaveLength(1)
    expect(doc.activePageId).toBe(doc.pages[0].id)
    expect(doc.pages[0].name).toBe('首页')
    expect(doc.pages[0].path).toBe('/')
  })

  it('createDoc 默认带三个断点与主题 token', () => {
    const doc = createDoc()
    expect(doc.breakpoints.map((b) => b.id)).toEqual(['desktop', 'tablet', 'mobile'])
    expect(doc.breakpoints.map((b) => b.minWidth)).toEqual([1200, 768, 0])
    expect(Object.keys(doc.theme.tokens)).toHaveLength(Object.keys(DEFAULT_THEME_TOKENS).length)
    expect(doc.theme.tokens['color-primary']).toBe('#3B82F6')
  })

  it('createPage 建出唯一根容器（frame + 视口尺寸 + position 0,0）', () => {
    const page = createPage('联系')
    expect(page.name).toBe('联系')
    expect(page.path).toBe('/')
    expect(page.viewport).toEqual(DEFAULT_VIEWPORT)
    const root = page.nodes[rootOf(page)]
    expect(root.type).toBe('frame')
    expect(root.parentId).toBeNull()
    expect(root.layout.position).toEqual({ x: 0, y: 0 })
    expect(root.layout.size).toEqual({
      w: { kind: 'fixed', value: DEFAULT_VIEWPORT.w },
      h: { kind: 'fixed', value: DEFAULT_VIEWPORT.h },
    })
    expect(rootsIn(page)).toHaveLength(1)
  })

  it('createRootFrame 用传入的视口尺寸', () => {
    const frame = createRootFrame('r', { w: 375, h: 812 })
    expect(frame.layout.size.w).toEqual({ kind: 'fixed', value: 375 })
    expect(frame.layout.size.h).toEqual({ kind: 'fixed', value: 812 })
    expect(frame.style).toEqual(DEFAULT_STYLE)
  })
})

describe('normalizeDoc 的拒绝与救回', () => {
  it('只有「不是对象」才拒绝', () => {
    for (const raw of [null, undefined, 42, 'x', true, []]) {
      expect(normalizeDoc(raw)).toBeNull()
    }
  })

  it('空对象救回成单页文档', () => {
    const doc = normalizeDoc({})
    expect(doc).not.toBeNull()
    expect(doc?.pages).toHaveLength(1)
    expect(doc?.pages[0].name).toBe('首页')
    expect(doc?.name).toBe('未命名项目')
    expect(doc?.breakpoints).toHaveLength(3)
  })

  it('pages 为空数组也补一页', () => {
    expect(normalizeDoc({ pages: [] })?.pages).toHaveLength(1)
  })

  it('activePageId 指向不存在的页时回落到第一页', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p1' }, { id: 'p2' }], activePageId: 'ghost' })
    expect(doc?.activePageId).toBe('p1')
    expect(normalizeDoc({ pages: [{ id: 'p1' }, { id: 'p2' }], activePageId: 'p2' })?.activePageId).toBe('p2')
  })

  it('页面 id 重复会被改名，页数与上限一致', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p1' }, { id: 'p1' }] })
    expect(doc?.pages.map((page) => page.id)).toEqual(['p1', 'p1_2'])
  })

  it('页面数上限 50', () => {
    const pages = Array.from({ length: 60 }, (_, index) => ({ id: `p${index}`, name: `页 ${index}` }))
    expect(normalizeDoc({ pages })?.pages).toHaveLength(50)
  })
})

describe('normalizePage 的收敛', () => {
  it('页名截断到 40、path 补斜杠、视口夹取', () => {
    const doc = normalizeDoc({
      pages: [{ id: 'p1', name: 'x'.repeat(60), path: 'about', viewport: { w: 100, h: 99_999 }, nodes: {} }],
    })
    const page = doc!.pages[0]
    expect(page.name).toHaveLength(40)
    expect(page.path).toBe('/about')
    expect(page.viewport).toEqual({ w: 200, h: 10_000 })
  })

  it('path 为空字符串回落成 /，缺 root 时自动建 frame', () => {
    const doc = normalizeDoc({ pages: [{ id: 'p1', path: '  ', nodes: {} }] })
    const page = doc!.pages[0]
    expect(page.path).toBe('/')
    expect(page.nodes[page.root].type).toBe('frame')
  })
})

describe('normalizeNodes 的四条不变量', () => {
  function pageFrom(nodes: Record<string, unknown>): Page {
    return normalizeDoc({ pages: [{ id: 'p1', root: 'r', nodes }] })!.pages[0]
  }

  it('除根之外没有任何节点 parentId 为 null', () => {
    const page = pageFrom({
      r: { id: 'r', type: 'frame', parentId: null },
      a: { id: 'a', type: 'rect', parentId: 'r' },
      orphan: { id: 'orphan', type: 'rect' },
      lonely: { id: 'lonely', type: 'rect', parentId: 'ghost' },
    })
    expect(rootsIn(page)).toEqual(['r'])
    expect(page.nodes.orphan.parentId).toBe('r')
    expect(page.nodes.lonely.parentId).toBe('r')
  })

  it('自己指向自己的 parentId 会被挂到根', () => {
    const page = pageFrom({ r: { id: 'r', type: 'frame', parentId: null }, a: { id: 'a', parentId: 'a' } })
    expect(page.nodes.a.parentId).toBe('r')
  })

  it('环会被断开，且每条父链都能走到根', () => {
    const page = pageFrom({
      r: { id: 'r', type: 'frame', parentId: null },
      a: { id: 'a', parentId: 'b' },
      b: { id: 'b', parentId: 'a' },
    })
    expect(rootsIn(page)).toEqual(['r'])
    for (const node of Object.values(page.nodes)) {
      let cursor = node.parentId
      let hops = 0
      while (cursor !== null && hops <= Object.keys(page.nodes).length) {
        cursor = page.nodes[cursor]?.parentId ?? null
        hops += 1
      }
      expect(cursor).toBeNull()
    }
  })

  it('id 冲突会改名，仓库键与节点 id 一致', () => {
    const page = pageFrom({
      r: { id: 'r', type: 'frame', parentId: null },
      a: { id: 'dup', parentId: 'r' },
      b: { id: 'dup', parentId: 'r' },
    })
    const ids = Object.keys(page.nodes)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('dup')
    expect(ids).toContain('dup_2')
    expect(page.nodes.dup_2.id).toBe('dup_2')
  })

  it('每级 order 重排成连续 0..n-1（保持原有相对顺序）', () => {
    const page = pageFrom({
      r: { id: 'r', type: 'frame', parentId: null },
      a: { id: 'a', parentId: 'r', order: 5 },
      b: { id: 'b', parentId: 'r', order: 9 },
      c: { id: 'c', parentId: 'r', order: 7 },
    })
    expect(page.nodes.a.order).toBe(0)
    expect(page.nodes.c.order).toBe(1)
    expect(page.nodes.b.order).toBe(2)
  })

  it('非对象输入退化成空节点表（只剩根）', () => {
    const page = pageFrom('not-an-object' as unknown as Record<string, unknown>)
    expect(Object.keys(page.nodes)).toEqual(['r'])
  })
})

describe('normalizeNode 的单节点收敛', () => {
  it('未知类型退化为 rect，frame/group 保留', () => {
    expect(normalizeType('nope')).toBe('rect')
    expect(normalizeType(42)).toBe('rect')
    expect(normalizeType('frame')).toBe('frame')
    expect(normalizeType('group')).toBe('group')
    expect(normalizeType('video')).toBe('video')
  })

  it('坐标夹取、尺寸最小 1、未知 kind 回落 fixed', () => {
    const node = normalizeNode({
      type: 'nope',
      layout: {
        position: { x: -5, y: 1e9 },
        size: { w: { kind: 'fixed', value: 0 }, h: { kind: 'weird' } },
      },
    })
    expect(node.type).toBe('rect')
    expect(node.layout.position).toEqual({ x: 0, y: MAX_COORD })
    expect(node.layout.size.w).toEqual({ kind: 'fixed', value: 1 })
    expect(node.layout.size.h).toEqual({ kind: 'fixed', value: 60 })
  })

  it('样式只接受合法值：opacity 夹 0..1、align 白名单、数字字符串可转、非字符串丢弃', () => {
    const node = normalizeNode({
      type: 'rect',
      style: { opacity: 5, align: 'middle', fontSize: '20', color: 123, letterSpacing: -4 },
    })
    expect(node.style.opacity).toBe(1)
    expect(node.style.align).toBe('left')
    expect(node.style.fontSize).toBe(20)
    expect(node.style.color).toBe('')
    expect(node.style.letterSpacing).toBe(0)
  })

  it('按类型补默认样式（button 的默认底色/圆角/字重）', () => {
    const style = normalizeStyle({}, 'button')
    expect(style.bg).toBe('#3B82F6')
    expect(style.color).toBe('#FFFFFF')
    expect(style.radius).toBe(8)
    expect(style.fontWeight).toBe(700)
    expect(style.align).toBe('center')
  })

  it('props 只留字符串/数字/布尔，超长文本截断', () => {
    const node = normalizeNode({
      props: { text: 'a'.repeat(MAX_TEXT + 10), bad: { deep: 1 }, list: [1, 2], ok: 'yes', n: 3, flag: true },
    })
    expect(String(node.props.text)).toHaveLength(MAX_TEXT)
    expect(node.props.bad).toBeUndefined()
    expect(node.props.list).toBeUndefined()
    expect(node.props.ok).toBe('yes')
    expect(node.props.n).toBe(3)
    expect(node.props.flag).toBe(true)
  })

  it('meta 名称去空白并截断 80，hidden/locked 只认严格布尔', () => {
    const node = normalizeNode({ meta: { name: `  ${'n'.repeat(120)}  `, hidden: 'yes', locked: 1 } })
    expect(node.meta.name).toHaveLength(80)
    expect(node.meta.hidden).toBe(false)
    expect(node.meta.locked).toBe(false)
  })

  it('空覆盖对象会被删掉，有效覆盖保留', () => {
    const node = normalizeNode({
      overrides: { tablet: {}, mobile: { order: 5, hidden: true, layout: { mode: 'grid' } }, broken: 42 },
    })
    expect(node.overrides.tablet).toBeUndefined()
    expect(node.overrides.broken).toBeUndefined()
    expect(node.overrides.mobile.order).toBe(5)
    expect(node.overrides.mobile.hidden).toBe(true)
    expect(node.overrides.mobile.layout?.mode).toBe('grid')
  })

  it('缺 id 时用兜底 id 或生成一个', () => {
    expect(normalizeNode({}, 'n1').id).toBe('n1')
    expect(normalizeNode({}).id).toMatch(/^n_/)
  })
})

describe('normalizeSize / normalizeBreakpoints / normalizeTheme', () => {
  it('normalizeSize 支持 fixed / ratio / fill 与夹取', () => {
    expect(normalizeSize({ kind: 'ratio', value: 0 }, { kind: 'fixed', value: 10 })).toEqual({
      kind: 'ratio',
      value: 0.01,
    })
    expect(normalizeSize({ kind: 'ratio', value: 500 }, { kind: 'fixed', value: 10 })).toEqual({
      kind: 'ratio',
      value: 100,
    })
    expect(normalizeSize({ kind: 'fill' }, { kind: 'fixed', value: 10 })).toEqual({ kind: 'fill' })
    expect(normalizeSize(null, { kind: 'fixed', value: 42 })).toEqual({ kind: 'fixed', value: 42 })
  })

  it('断点缺省/空数组回落默认三档', () => {
    expect(normalizeBreakpoints(undefined)).toHaveLength(3)
    expect(normalizeBreakpoints([])).toHaveLength(3)
    expect(normalizeBreakpoints('x').map((b) => b.id)).toEqual(['desktop', 'tablet', 'mobile'])
  })

  it('断点 id 去重、按 minWidth 降序、enabled 保留', () => {
    const breakpoints = normalizeBreakpoints([
      { id: 'a', minWidth: 500 },
      { id: 'a', minWidth: 1000 },
      { label: '无 id' },
      { id: 'off', minWidth: 0, enabled: false },
    ])
    expect(new Set(breakpoints.map((b) => b.id)).size).toBe(4)
    expect(breakpoints.map((b) => b.minWidth)).toEqual([1000, 500, 0, 0])
    expect(breakpoints.find((b) => b.id === 'off')?.enabled).toBe(false)
    expect(breakpoints.find((b) => b.minWidth === 1000)?.id).toBe('a_2')
  })

  it('主题 token 只接受短字符串，其余回落默认值', () => {
    const theme = normalizeTheme({ tokens: { 'color-primary': '#000', bad: 5, long: 'x'.repeat(201) } })
    expect(theme.tokens['color-primary']).toBe('#000')
    expect(theme.tokens.bad).toBeUndefined()
    expect(theme.tokens.long).toBeUndefined()
    expect(theme.tokens['color-text']).toBe('#1E293B')
  })

  it('normalizeNodes 在空输入时返回空表（根容器由 normalizePage 负责建）', () => {
    expect(normalizeNodes(undefined, 'r')).toEqual({})
    expect(normalizeNodes('not-an-object', 'r')).toEqual({})
  })
})

describe('M22 旧文档输入类的迁移', () => {
  function inputNode(extra: Record<string, unknown>): Page {
    return normalizeDoc({
      pages: [
        {
          id: 'p1',
          root: 'r',
          nodes: {
            r: { id: 'r', type: 'frame', parentId: null },
            i: { id: 'i', type: 'input', parentId: 'r', ...extra },
          },
        },
      ],
    })!.pages[0]
  }

  it('v1 占位灰 #64748B 迁成正文色，text 搬到 placeholder', () => {
    const page = inputNode({ style: { color: '#64748B' }, props: { text: '请输入…' } })
    expect(page.nodes.i.style.color).toBe('#1E293B')
    expect(page.nodes.i.props.placeholder).toBe('请输入…')
    expect(page.nodes.i.props.text).toBe('')
  })

  it('用户自己挑的颜色不动，已有 placeholder 时 text 保留', () => {
    const page = inputNode({ style: { color: '#FF0000' }, props: { text: '标签', placeholder: '手机号' } })
    expect(page.nodes.i.style.color).toBe('#FF0000')
    expect(page.nodes.i.props.placeholder).toBe('手机号')
    expect(page.nodes.i.props.text).toBe('标签')
  })

  it('断点覆盖里的旧灰色也一起迁移', () => {
    const page = inputNode({
      style: { color: '#64748B' },
      overrides: { mobile: { style: { color: '#64748B' } } },
    })
    expect(page.nodes.i.overrides.mobile?.style?.color).toBe('#1E293B')
  })
})
