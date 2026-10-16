import { describe, expect, it } from 'vitest'
import {
  captureSymbol,
  expandInstances,
  instanceIdOf,
  instancesOf,
  isSyntheticId,
  masterIdOf,
  symbolReferences,
  syntheticId,
} from '@/core/symbols'
import type { SymbolDef } from '@/core/schema/types'
import { makeDoc, makeNode, makeNodes, makePage } from './factories'

/** 一个 master：section(容器) → text，尺寸 300×120 */
function masterNodes() {
  const section = makeNode({ id: 'sec', type: 'section', parentId: 'root', order: 0 })
  const text = makeNode({ id: 'txt', type: 'text', parentId: 'sec', order: 0, props: { text: '原始文案' } })
  return makeNodes([section, text])
}

describe('core/symbols：从选区抓取组件（master）', () => {
  it('抓取子树成 SymbolDef：克隆、保留 id 与相对顺序、不改原节点', () => {
    const nodes = masterNodes()
    const def = captureSymbol(nodes, 'sec', '卡片组件')
    expect(def.name).toBe('卡片组件')
    expect(def.root).toBe('sec')
    expect(Object.keys(def.nodes).sort()).toEqual(['sec', 'txt'])
    expect(def.nodes.sec.parentId).toBe('root')
    expect(def.nodes.txt.parentId).toBe('sec')
    expect(def.overridable).toEqual(['text', 'color', 'fontSize', 'bg'])

    def.nodes.txt.props.text = '改过的'
    expect(nodes.txt.props.text).toBe('原始文案')
  })

  it('抓取时可以指定覆盖白名单，且顺序按给定数组', () => {
    const def = captureSymbol(masterNodes(), 'sec', '组件', ['text'])
    expect(def.overridable).toEqual(['text'])
  })

  it('根 id 不存在时抛错（调用方必须先校验选区）', () => {
    expect(() => captureSymbol(masterNodes(), 'nope', '组件')).toThrow(/不存在/)
  })
})

describe('core/symbols：实例展开', () => {
  const def: SymbolDef = captureSymbol(masterNodes(), 'sec', '卡片组件')

  function pageWithInstances(count: number) {
    const root = makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 })
    const list: ReturnType<typeof makeNode>[] = [root]
    for (let index = 0; index < count; index += 1) {
      list.push(
        makeNode({
          id: `inst${index}`,
          type: 'instance',
          parentId: 'root',
          order: index,
          props: { symbolId: def.id },
          layout: {
            mode: 'vertical',
            position: { x: 0, y: index * 130 },
            size: { w: { kind: 'fixed', value: 300 }, h: { kind: 'fixed', value: 120 } },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            gap: 0,
            columns: 1,
            align: 'start',
            justify: 'start',
            wrap: false,
            constraints: { h: 'left', v: 'top' },
          },
        }),
      )
    }
    return makePage({ id: 'p1', root: 'root', nodes: makeNodes(list) })
  }

  it('实例展开成 master 子树的克隆，id 带实例前缀，实例自身几何保留', () => {
    const page = pageWithInstances(1)
    const doc = makeDoc({ pages: [page], symbols: { [def.id]: def } })
    const expanded = expandInstances(page, doc)
    expect(Object.keys(expanded).sort()).toEqual(
      ['inst0', 'root', syntheticId('inst0', 'sec'), syntheticId('inst0', 'txt')].sort(),
    )
    const inst = expanded.inst0
    expect(inst.layout.size.w).toEqual({ kind: 'fixed', value: 300 })
    expect(expanded[syntheticId('inst0', 'sec')].parentId).toBe('inst0')
    expect(expanded[syntheticId('inst0', 'txt')].parentId).toBe(syntheticId('inst0', 'sec'))
    expect(expanded[syntheticId('inst0', 'txt')].props.text).toBe('原始文案')
    // 原页面不动（纯函数）
    expect(Object.keys(page.nodes).sort()).toEqual(['inst0', 'root'])
  })

  it('三实例共享 master，改 master 后三份展开全部同步', () => {
    const page = pageWithInstances(3)
    const changed: SymbolDef = {
      ...def,
      nodes: { ...def.nodes, txt: { ...def.nodes.txt, props: { text: '新文案' } } },
    }
    const doc = makeDoc({ pages: [page], symbols: { [def.id]: changed } })
    const expanded = expandInstances(page, doc)
    const texts = ['inst0', 'inst1', 'inst2'].map(
      (id) => expanded[syntheticId(id, 'txt')].props.text,
    )
    expect(texts).toEqual(['新文案', '新文案', '新文案'])
  })

  it('实例 props 只在白名单内覆盖 master 根节点，白名单外的键被忽略', () => {
    const page = pageWithInstances(1)
    page.nodes.inst0.props = { symbolId: def.id, text: '实例文案', sub: '不该生效' }
    const doc = makeDoc({ pages: [page], symbols: { [def.id]: def } })
    const expanded = expandInstances(page, doc)
    const master = expanded[syntheticId('inst0', 'sec')]
    expect(master.props.text).toBe('实例文案')
    expect(master.props.sub).toBeUndefined()
    expect(expanded[syntheticId('inst0', 'txt')].props.text).toBe('原始文案')
  })

  it('symbolId 缺失或指向不存在的组件时展开为空子节点，并标记 unknown', () => {
    const page = pageWithInstances(1)
    page.nodes.inst0.props = { symbolId: 'missing' }
    const doc = makeDoc({ pages: [page], symbols: { [def.id]: def } })
    const expanded = expandInstances(page, doc)
    expect(Object.keys(expanded).sort()).toEqual(['inst0', 'root'])
    expect(expanded.inst0.props.unknown).toBe(true)

    page.nodes.inst0.props = {}
    const noId = expandInstances(page, doc)
    expect(noId.inst0.props.unknown).toBe(true)
  })

  it('循环引用（组件里嵌自己）不无限展开，标记 cycle', () => {
    const loop: SymbolDef = {
      id: 'sym_loop',
      name: '自引用',
      root: 'sec',
      overridable: ['text'],
      nodes: makeNodes([
        makeNode({ id: 'sec', type: 'section', parentId: 'root', order: 0 }),
        makeNode({ id: 'inner', type: 'instance', parentId: 'sec', order: 0, props: { symbolId: 'sym_loop' } }),
      ]),
    }
    const page = pageWithInstances(1)
    page.nodes.inst0.props = { symbolId: 'sym_loop' }
    const doc = makeDoc({ pages: [page], symbols: { sym_loop: loop } })
    const expanded = expandInstances(page, doc)
    const inner = expanded[syntheticId('inst0', 'inner')]
    expect(inner).toBeDefined()
    expect(inner.props.cycle).toBe(true)
    expect(Object.keys(expanded)).toHaveLength(4)
  })

  it('互相引用的两个组件也不死循环（A 含 B 实例、B 含 A 实例）', () => {
    const a: SymbolDef = {
      id: 'sym_a',
      name: 'A',
      root: 'a',
      overridable: [],
      nodes: makeNodes([
        makeNode({ id: 'a', type: 'section', parentId: 'root', order: 0 }),
        makeNode({ id: 'a_to_b', type: 'instance', parentId: 'a', order: 0, props: { symbolId: 'sym_b' } }),
      ]),
    }
    const b: SymbolDef = {
      id: 'sym_b',
      name: 'B',
      root: 'b',
      overridable: [],
      nodes: makeNodes([
        makeNode({ id: 'b', type: 'section', parentId: 'root', order: 0 }),
        makeNode({ id: 'b_to_a', type: 'instance', parentId: 'b', order: 0, props: { symbolId: 'sym_a' } }),
      ]),
    }
    const page = pageWithInstances(1)
    page.nodes.inst0.props = { symbolId: 'sym_a' }
    const doc = makeDoc({ pages: [page], symbols: { sym_a: a, sym_b: b } })
    const expanded = expandInstances(page, doc)
    const deepest = expanded[syntheticId(syntheticId('inst0', 'a_to_b'), 'b_to_a')]
    expect(deepest.props.cycle).toBe(true)
  })
})

describe('core/symbols：工具函数与实例索引', () => {
  it('合成 id 可往返解析，真实 id 不被误判', () => {
    const id = syntheticId('inst0', 'txt')
    expect(id).toBe('inst0~txt')
    expect(isSyntheticId(id)).toBe(true)
    expect(isSyntheticId('inst0')).toBe(false)
    expect(instanceIdOf(id)).toBe('inst0')
    expect(masterIdOf(id)).toBe('txt')
    expect(instanceIdOf('inst0')).toBe('inst0')
    expect(masterIdOf('inst0')).toBe('')
  })

  it('instancesOf 跨页面找出引用某组件的全部实例', () => {
    const def = captureSymbol(masterNodes(), 'sec', '卡片组件')
    const pageA = makePage({
      id: 'p1',
      nodes: makeNodes([
        makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
        makeNode({ id: 'i1', type: 'instance', parentId: 'root', order: 0, props: { symbolId: def.id } }),
      ]),
    })
    const pageB = makePage({
      id: 'p2',
      root: 'rootB',
      nodes: makeNodes([
        makeNode({ id: 'rootB', type: 'frame', parentId: null, order: 0 }),
        makeNode({ id: 'i2', type: 'instance', parentId: 'rootB', order: 0, props: { symbolId: def.id } }),
        makeNode({ id: 'i3', type: 'instance', parentId: 'rootB', order: 1, props: { symbolId: 'other' } }),
      ]),
    })
    const doc = makeDoc({ pages: [pageA, pageB], symbols: { [def.id]: def } })
    expect(instancesOf(doc, def.id)).toEqual([
      { pageId: 'p1', nodeId: 'i1' },
      { pageId: 'p2', nodeId: 'i2' },
    ])
  })

  it('captureSymbol 生成稳定的 id 前缀（同一份节点两次抓取同名同结构）', () => {
    const one = captureSymbol(masterNodes(), 'sec', '卡片组件')
    const two = captureSymbol(masterNodes(), 'sec', '卡片组件')
    expect(one.id).toBe(two.id)
  })
})

describe('core/symbols：循环引用校验与展开兜底', () => {
  function chain(): Record<string, SymbolDef> {
    const symbol = (id: string, root: string, nested?: string): SymbolDef => ({
      id,
      name: id,
      root,
      overridable: [],
      nodes: makeNodes([
        makeNode({ id: root, type: 'section', parentId: 'root', order: 0 }),
        ...(nested
          ? [makeNode({ id: `${root}_i`, type: 'instance', parentId: root, order: 0, props: { symbolId: nested } })]
          : []),
      ]),
    })
    return {
      sym_a: symbol('sym_a', 'a', 'sym_b'),
      sym_b: symbol('sym_b', 'b', 'sym_c'),
      sym_c: symbol('sym_c', 'c'),
    }
  }

  it('symbolReferences：直接自引用、多级间接引用、同 id、无引用、未注册组件', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'p1' })], symbols: chain() })
    expect(symbolReferences(doc, 'sym_a', 'sym_a')).toBe(true)
    expect(symbolReferences(doc, 'sym_a', 'sym_c')).toBe(true)
    expect(symbolReferences(doc, 'sym_c', 'sym_a')).toBe(false)
    expect(symbolReferences(doc, 'sym_a', 'sym_missing')).toBe(false)
    expect(symbolReferences(doc, 'sym_missing', 'sym_a')).toBe(false)
  })

  it('文档没有 symbols 字段时，实例被标记 unknown 而不是崩掉', () => {
    const page = makePage({
      id: 'p1',
      nodes: makeNodes([
        makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
        makeNode({ id: 'inst', type: 'instance', parentId: 'root', order: 0, props: { symbolId: 'sym_a' } }),
      ]),
    })
    const doc = makeDoc({ pages: [page] })
    delete (doc as { symbols?: unknown }).symbols
    const expanded = expandInstances(page, doc)
    expect(expanded.inst.props.unknown).toBe(true)
    expect(Object.keys(expanded)).toEqual(['root', 'inst'])
  })

  it('master 内部层级按合成 id 续接：第二层挂在第一层的合成 id 下，根挂在实例上', () => {
    const def: SymbolDef = {
      id: 'sym_tree',
      name: '两级组件',
      root: 'sec',
      overridable: [],
      nodes: makeNodes([
        makeNode({ id: 'sec', type: 'section', parentId: 'root', order: 0 }),
        makeNode({ id: 'txt', type: 'text', parentId: 'sec', order: 0, props: { text: '正文' } }),
      ]),
    }
    const page = makePage({
      id: 'p1',
      nodes: makeNodes([
        makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
        makeNode({ id: 'inst', type: 'instance', parentId: 'root', order: 0, props: { symbolId: 'sym_tree' } }),
      ]),
    })
    const doc = makeDoc({ pages: [page], symbols: { sym_tree: def } })
    const expanded = expandInstances(page, doc)
    expect(expanded[syntheticId('inst', 'sec')].parentId).toBe('inst')
    expect(expanded[syntheticId('inst', 'txt')].parentId).toBe(syntheticId('inst', 'sec'))
  })

  it('嵌套实例自己没有 symbolId 时按 unknown 收尾，不再递归', () => {
    const def: SymbolDef = {
      id: 'sym_nested',
      name: '嵌套组件',
      root: 'sec',
      overridable: [],
      nodes: makeNodes([
        makeNode({ id: 'sec', type: 'section', parentId: 'root', order: 0 }),
        makeNode({ id: 'inner', type: 'instance', parentId: 'sec', order: 0, props: {} }),
      ]),
    }
    const page = makePage({
      id: 'p1',
      nodes: makeNodes([
        makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
        makeNode({ id: 'inst', type: 'instance', parentId: 'root', order: 0, props: { symbolId: 'sym_nested' } }),
      ]),
    })
    const doc = makeDoc({ pages: [page], symbols: { sym_nested: def } })
    const expanded = expandInstances(page, doc)
    expect(expanded[syntheticId('inst', 'inner')].props.unknown).toBe(true)
  })
})
