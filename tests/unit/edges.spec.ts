/**
 * 边界与失败路径：这些用例覆盖的是「正常输入之外」的分支——
 * 收敛层遇到非对象、迁移遇到脏页/脏元素、历史合并被拒绝、几何等比缩放取高度优先……
 * 它们同时把 core 的分支覆盖率顶到阈值以上。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Doc, NodeId, Page, SceneNode } from '@/core/schema/types'
import { normalizeBreakpoints, normalizeNode, normalizeOverrides, normalizePage } from '@/core/schema/normalize'
import { isLegacyProject, migrateFromWebBuilderV1 } from '@/core/schema/migrate'
import { parseImportedDoc } from '@/core/schema/parse'
import { applyPatches, cloneNode } from '@/core/patch'
import type { Patch } from '@/core/schema/types'
import { canonicalNodes, nextOrder } from '@/core/tree'
import { commitEntry, createHistory, historyLabels, historyPosition, undoEntry } from '@/core/history'
import { insertAtEndPatch, insertPatch, updatePatch } from '@/core/ops'
import { resizeBox } from '@/core/geometry'
import { generateHtml, safeUrl } from '@/core/codegen'
import { clearDoc, isStorageAvailable, loadDoc, saveDoc, STORAGE_KEY } from '@/core/persistence'
import { docWithNodes, makeDoc, makeNode, makeNodes, makePage } from './factories'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('收敛层：非对象与脏结构', () => {
  it('normalizePage 收到非对象时用 fallbackId 造一页', () => {
    const page = normalizePage('nope', 'p9')
    expect(page.id).toBe('p9')
    expect(page.name).toBe('未命名页面')
    expect(page.nodes[page.root]).toBeTruthy()
  })

  it('normalizeNode 收到非对象时造一个兜底 rect', () => {
    const node = normalizeNode(42, 'n_fallback')
    expect(node.id).toBe('n_fallback')
    expect(node.type).toBe('rect')
  })

  it('normalizeBreakpoints 遇到数组里的非对象项时按缺省补一条', () => {
    const breakpoints = normalizeBreakpoints(['nope', null, { id: 'wide', minWidth: 900 }])
    expect(breakpoints).toHaveLength(3)
    const fallback = breakpoints.filter((item) => item.id !== 'wide')
    for (const item of fallback) {
      expect(item.id.startsWith('bp')).toBe(true)
      expect(item.label).toBe(item.id)
      expect(item.minWidth).toBe(0)
      expect(item.enabled).toBe(true)
    }
  })

  it('normalizeOverrides 保留 layout/style/props/order/hidden，丢掉空覆盖', () => {
    const overrides = normalizeOverrides({
      '': { hidden: true },
      bp1: {
        layout: { position: { x: 5, y: 6 } },
        style: { color: '#ffffff' },
        props: { text: '移动端文案' },
        order: 3.9,
        hidden: false,
      },
      bp2: { nothing: true },
      bp3: 'nope',
    })
    expect(Object.keys(overrides)).toEqual(['bp1'])
    expect(overrides.bp1.layout?.position).toEqual({ x: 5, y: 6 })
    expect(overrides.bp1.style?.color).toBe('#ffffff')
    expect(overrides.bp1.props?.text).toBe('移动端文案')
    // order 走整数夹取（3.9 → 4）
    expect(overrides.bp1.order).toBe(4)
    expect(overrides.bp1.hidden).toBe(false)
  })
})

describe('v1 迁移：脏页与脏元素', () => {
  it('没有 pages 的 v1 项目迁移失败（parseImportedDoc 报专属错误）', () => {
    const raw = { app: 'visual-builder' }
    expect(isLegacyProject(raw)).toBe(true)
    expect(migrateFromWebBuilderV1(raw)).toBeNull()
    const result = parseImportedDoc(JSON.stringify(raw))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('不是有效的 WebBuilder 项目')
  })

  it('pages 里混入非对象项：补一个空页，元素退化成 rect', () => {
    const doc = migrateFromWebBuilderV1({
      app: 'visual-builder',
      pages: ['nope', { id: 'p2', elements: ['nope', { type: 'text', x: 10, y: 20, name: '标题' }] }],
    })
    expect(doc).not.toBeNull()
    expect(doc!.pages).toHaveLength(2)
    expect(doc!.pages[0].name).toBe('未命名页面')
    expect(doc!.pages[0].path).toBe('/')
    const second = doc!.pages[1]
    const nodes = Object.values(second.nodes)
    // 'nope' 元素退化成 rect，另一个仍是 text
    expect(nodes.filter((node) => node.type === 'rect')).toHaveLength(1)
    expect(nodes.filter((node) => node.type === 'text')).toHaveLength(1)
    expect(nodes.some((node) => node.meta.name === '标题')).toBe(true)
  })

  it('缺 id 的页按 page_<n> 补，activePageId 命不中就回首页', () => {
    const doc = migrateFromWebBuilderV1({
      app: 'visual-builder',
      activePageId: 'ghost',
      pages: [{ elements: [] }, { id: 'p2', elements: [] }],
    })
    expect(doc!.pages.map((page) => page.id)).toEqual(['page_1', 'p2'])
    expect(doc!.activePageId).toBe('page_1')
  })

  it('文档名优先取 options.name，其次 raw.name，最后兜底', () => {
    const base = { app: 'visual-builder', name: 'Landing Page', pages: [{ id: 'p1', elements: [] }] }
    expect(migrateFromWebBuilderV1(base)!.name).toBe('Landing Page')
    expect(migrateFromWebBuilderV1(base, { name: '我的站点' })!.name).toBe('我的站点')
    expect(migrateFromWebBuilderV1({ ...base, name: '   ' })!.name).toBe('WebBuilder 导入的项目')
  })
})

describe('补丁：覆盖与克隆', () => {
  it('cloneNode 深拷贝 overrides，改副本不影响原节点', () => {
    const node = makeNode({
      id: 'n1',
      overrides: { mobile: { layout: { position: { x: 1, y: 2 } } as SceneNode['layout'], props: { text: 'a' } } },
    })
    const copy = cloneNode(node)
    const mobile = copy.overrides.mobile!
    mobile.layout!.position!.x = 999
    mobile.props!.text = 'changed'
    expect(node.overrides.mobile?.layout?.position).toEqual({ x: 1, y: 2 })
    expect(node.overrides.mobile?.props?.text).toBe('a')
  })

  it('对带 overrides 的节点打补丁后，overrides 仍被独立克隆', () => {
    const node = makeNode({ id: 'n1', overrides: { mobile: { props: { text: 'a' } } } })
    const doc: Doc = makeDoc({
      pages: [makePage({ id: 'page_1', nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), node]) })],
    })
    const next = applyPatches(doc, [updatePatch('page_1', 'n1', { props: { text: 'a' } }, { props: { text: 'b' } })])
    expect(next.pages[0].nodes.n1.props.text).toBe('b')
    expect(doc.pages[0].nodes.n1.props.text).toBeUndefined()
    expect(next.pages[0].nodes.n1.overrides.mobile.props?.text).toBe('a')
  })
})

describe('ops：尾部插入', () => {
  it('insertAtEndPatch 落在同级末尾', () => {
    const page = makePage({ id: 'page_1' })
    const patch = insertAtEndPatch(page, 'text', page.root, { x: 5, y: 5 })
    expect(patch.op).toBe('insert')
    if (patch.op === 'insert') {
      expect(patch.pageId).toBe('page_1')
      expect(patch.node.type).toBe('text')
      expect(patch.node.parentId).toBe(page.root)
      expect(patch.node.order).toBe(nextOrder(page.nodes, page.root))
    }
  })
})

describe('树：canonicalNodes 的孤儿兜底', () => {
  it('父级不存在的孤儿按 order 再按 id 排在末尾', () => {
    const nodes = makeNodes([
      makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
      makeNode({ id: 'b', parentId: 'ghost', order: 1 }),
      makeNode({ id: 'a', parentId: 'ghost', order: 1 }),
    ])
    expect(Object.keys(canonicalNodes(nodes))).toEqual(['root', 'a', 'b'])
  })
})

describe('几何：等比缩放的两种取值', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 }

  it('宽度变化更大时按宽度推高度', () => {
    const next = resizeBox(box, 'se', 50, 0, { minW: 8, minH: 8, keepRatio: true })
    expect(next.w).toBe(150)
    expect(next.h).toBe(150)
  })

  it('高度变化更大时按高度推宽度', () => {
    const next = resizeBox(box, 'se', 0, 50, { minW: 8, minH: 8, keepRatio: true })
    expect(next.h).toBe(150)
    expect(next.w).toBe(150)
  })
})

describe('代码生成：相对路径与页面回退', () => {
  it('safeUrl 放行无协议的相对路径，拦掉其它协议', () => {
    expect(safeUrl('a.png')).toBe('a.png')
    expect(safeUrl('mailto:hi@example.com')).toBe('')
    expect(safeUrl('  /assets/x.png  ')).toBe('/assets/x.png')
  })

  it('页面 key 命中不了时回退到 activePageId，再回退到第一页', () => {
    const first = makePage({ id: 'page_1', name: '首页' })
    const second = makePage({ id: 'page_2', name: '第二页', path: '/two', nodes: makeNodes([makeNode({ id: 'root', type: 'frame' })]) })
    const doc = makeDoc({ pages: [first, second], activePageId: 'page_2' })
    expect(generateHtml(doc, 'nope')).toContain('data-page="page_2"')
    const broken = makeDoc({ pages: [first, second], activePageId: 'ghost' })
    expect(generateHtml(broken, 'nope')).toContain('data-page="page_1"')
  })
})

describe('历史：合并被拒绝的三种情况', () => {
  const page = makePage({ id: 'page_1' })
  const doc: Doc = makeDoc({ pages: [page] })
  const textPatch = (id: NodeId, from: string, to: string): Patch => updatePatch('page_1', id, { props: { text: from } }, { props: { text: to } })

  it('补丁条数不同不合并', () => {
    const state = commitEntry(createHistory(doc), { label: '两次改动', patches: [textPatch('n1', 'a', 'b'), textPatch('n2', 'a', 'b')], mergeKey: 'k', at: 0 })
    const next = commitEntry(state, { label: '一次改动', patches: [textPatch('n1', 'b', 'c')], mergeKey: 'k', at: 100 })
    expect(next.undo).toHaveLength(2)
    expect(historyLabels(next)).toEqual(['初始状态', '两次改动', '一次改动'])
  })

  it('同键不同节点不合并', () => {
    const state = commitEntry(createHistory(doc), { label: '改 n1', patches: [textPatch('n1', 'a', 'b')], mergeKey: 'k', at: 0 })
    const next = commitEntry(state, { label: '改 n2', patches: [textPatch('n2', 'a', 'b')], mergeKey: 'k', at: 100 })
    expect(next.undo).toHaveLength(2)
  })

  it('结构补丁（insert）即使 mergeKey 相同也不合并', () => {
    const node = makeNode({ id: 'n9', parentId: 'root', order: 1 })
    const state = commitEntry(createHistory(doc), { label: '加一个', patches: [insertPatch('page_1', node)], mergeKey: 'k', at: 0 })
    const next = commitEntry(state, { label: '再加一个', patches: [insertPatch('page_1', { ...node, id: 'n10' })], mergeKey: 'k', at: 100 })
    expect(next.undo).toHaveLength(2)
  })

  it('超过合并窗口的两条 update 各占一步，撤销回得去', () => {
    const start: Doc = docWithNodes([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'n1', parentId: 'root', order: 0, props: { text: 'a' } })])
    let state = commitEntry(createHistory(start), { label: '改成 b', patches: [textPatch('n1', 'a', 'b')], mergeKey: 'k', at: 0 })
    state = commitEntry(state, { label: '改成 c', patches: [textPatch('n1', 'b', 'c')], mergeKey: 'k', at: 10_000 })
    expect(state.undo).toHaveLength(2)
    expect(state.base.pages[0].nodes.n1.props.text).toBe('c')
    const back = undoEntry(state)
    expect(back.base.pages[0].nodes.n1.props.text).toBe('b')
    expect(historyPosition(back)).toBe(1)
  })
})

describe('持久化：localStorage 不可用时的静默降级', () => {
  it('读 localStorage 抛错时全部降级为「没有存档」', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(isStorageAvailable()).toBe(false)
    expect(saveDoc(makeDoc())).toBe(false)
    expect(loadDoc()).toBeNull()
    expect(() => clearDoc()).not.toThrow()
  })

  it('存档是数组或空页列表时当作没有存档', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
    expect(loadDoc()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, pages: [] }))
    expect(loadDoc()).toBeNull()
  })

  it('页面形状合法但内容脏时会过收敛层修正', () => {
    const page: Pick<Page, 'id' | 'name' | 'path' | 'root'> = { id: 'page_1', name: '首页', path: '/', root: 'root' }
    const dirty: Doc = makeDoc({
      pages: [makePage({ ...page, viewport: { w: 99_999, h: -5 } })],
      activePageId: 'ghost',
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dirty))
    const loaded = loadDoc()
    expect(loaded).not.toBeNull()
    expect(loaded!.pages[0].viewport).toEqual({ w: 10_000, h: 200 })
    expect(loaded!.activePageId).toBe('page_1')
  })
})
