import { describe, expect, it } from 'vitest'
import {
  CONTENT_KEYS,
  createDoc,
  isLegacyProject,
  LEGACY_MAX_ELEMENTS_PER_PAGE,
  LEGACY_MAX_PAGES,
  migrateFromWebBuilderV1,
  parseImportedDoc,
  STYLE_KEYS,
  V1_PROP_KEYS,
} from '@/core/schema'
import type { Page } from '@/core/schema'
import { childrenOf } from '@/core/tree'
import type { LegacyElement } from './fixtures/legacyV1'
import { legacyDirtyPage, legacyManyPages, legacyProductLanding, legacyStorageShape } from './fixtures/legacyV1'

function sourceElements(project: typeof legacyProductLanding, pageIndex = 0): LegacyElement[] {
  return project.pages[pageIndex].elements as LegacyElement[]
}

function imported(elements: LegacyElement[]): Page {
  const doc = migrateFromWebBuilderV1({ app: 'visual-builder', version: 1, pages: [{ id: 'p1', elements }] })
  return doc!.pages[0]
}

describe('isLegacyProject', () => {
  it('认得导出文件与 localStorage 两种形状', () => {
    expect(isLegacyProject(legacyProductLanding)).toBe(true)
    expect(isLegacyProject(legacyStorageShape)).toBe(true)
    expect(isLegacyProject({ app: 'visual-builder', pages: [{}] })).toBe(true)
    expect(isLegacyProject({ pages: [{ elements: [] }] })).toBe(true)
  })

  it('不把别的东西当 v1 项目', () => {
    for (const raw of [null, 42, 'x', {}, { pages: [] }, { pages: [{ name: 'x' }] }, { pages: 'x' }]) {
      expect(isLegacyProject(raw)).toBe(false)
    }
  })
})

describe('migrateFromWebBuilderV1 的拒绝面', () => {
  it('页面缺失、为空或不是数组时返回 null', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { pages: [] }, { pages: 'x' }]) {
      expect(migrateFromWebBuilderV1(raw)).toBeNull()
    }
  })
})

describe('migrateFromWebBuilderV1：真实「产品落地页」模板', () => {
  const doc = migrateFromWebBuilderV1(legacyProductLanding)!

  it('产出 version 2 的文档，页面 id/名称/根容器都对', () => {
    expect(doc.version).toBe(2)
    expect(doc.pages).toHaveLength(1)
    const page = doc.pages[0]
    expect(page.id).toBe('p1')
    expect(page.name).toBe('产品落地页')
    expect(page.path).toBe('/')
    expect(page.root).toBe('root_p1')
    expect(page.nodes[page.root].type).toBe('frame')
    expect(page.nodes[page.root].parentId).toBeNull()
    expect(page.nodes[page.root].layout.position).toEqual({ x: 0, y: 0 })
    expect(page.nodes[page.root].layout.size).toEqual({
      w: { kind: 'fixed', value: 1440 },
      h: { kind: 'fixed', value: 900 },
    })
  })

  it('8 个元素全部挂到根容器下，order 连续且与源顺序一致', () => {
    const elements = sourceElements(legacyProductLanding)
    expect(elements).toHaveLength(8)
    const children = childrenOf(doc.pages[0].nodes, doc.pages[0].root)
    expect(children.map((node) => node.id)).toEqual(['el1', 'el2', 'el3', 'el4', 'el5', 'el6', 'el7', 'el8'])
    expect(children.map((node) => node.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (const child of children) expect(child.parentId).toBe(doc.pages[0].root)
  })

  it('坐标 / 尺寸 / 类型一个都不变（不倒退的核心）', () => {
    const elements = sourceElements(legacyProductLanding)
    elements.forEach((element, index) => {
      const node = doc.pages[0].nodes[element.id as string]
      expect(node.type).toBe(element.type)
      expect(node.order).toBe(index)
      expect(node.layout.position).toEqual({ x: element.x, y: element.y })
      expect(node.layout.size).toEqual({
        w: { kind: 'fixed', value: element.w },
        h: { kind: 'fixed', value: element.h },
      })
    })
  })

  it('22 个白名单属性全部落到 style / props / meta 三个桶', () => {
    const elements = sourceElements(legacyProductLanding)
    for (const element of elements) {
      const node = doc.pages[0].nodes[element.id as string]
      for (const key of V1_PROP_KEYS) {
        const value = element.props?.[key]
        if (value === undefined) continue
        if (key === 'hidden') expect(node.meta.hidden).toBe(Boolean(value))
        else if (key === 'locked') expect(node.meta.locked).toBe(Boolean(value))
        else if ((STYLE_KEYS as readonly string[]).includes(key)) {
          expect(node.style[key as keyof typeof node.style]).toBe(value)
        } else if ((CONTENT_KEYS as readonly string[]).includes(key)) {
          expect(node.props[key]).toBe(String(value))
        }
      }
    }
  })

  it('同一元素上的多个样式键都保留（逐个 Object.assign 会互相覆盖）', () => {
    const nodes = doc.pages[0].nodes
    expect(nodes.el1.style.bg).toBe('#1A1A2E')
    expect(nodes.el1.style.color).toBe('#FFFFFF')
    expect(nodes.el1.style.fontSize).toBe(14)

    expect(nodes.el2.style.fontSize).toBe(34)
    expect(nodes.el2.style.color).toBe('#1E293B')
    expect(nodes.el2.style.bg).toBe('#F0F4FF')
    expect(nodes.el2.props.text).toBe('让 AI 帮你写出更好的代码')
    expect(nodes.el2.props.sub).toBe('新一代 AI 编程助手，支持 30+ 语言')

    expect(nodes.el3.style.radius).toBe(8)
    expect(nodes.el3.style.fontWeight).toBe(700)
    expect(nodes.el3.style.align).toBe('center')
    expect(nodes.el3.style.shadowBlur).toBe(12)
    expect(nodes.el3.style.shadowColor).toBe('rgba(59,130,246,0.4)')
    expect(nodes.el3.props.text).toBe('免费开始')

    expect(nodes.el4.style.radius).toBe(14)
    expect(nodes.el4.style.shadowBlur).toBe(16)
    expect(nodes.el4.style.fontSize).toBe(17)
    expect(nodes.el4.style.bg).toBe('#FFFFFF')
    expect(nodes.el4.props.text).toBe('智能补全')
  })

  it('图层名进 meta.name，没名字的元素没有该键', () => {
    expect(doc.pages[0].nodes.el3.meta.name).toBe('主视觉按钮')
    expect(doc.pages[0].nodes.el8.meta.name).toBe('页脚版权')
    expect(doc.pages[0].nodes.el1.meta.name).toBeUndefined()
  })

  it('内容属性缺失时按类型补默认文案（看着一样）', () => {
    const page = imported([{ id: 'el1', type: 'text', x: 0, y: 0, w: 100, h: 30 }])
    expect(page.nodes.el1.props.text).toBe('双击编辑文字')
  })

  it('文档名默认值可被覆盖', () => {
    expect(doc.name).toBe('WebBuilder 导入的项目')
    expect(migrateFromWebBuilderV1(legacyProductLanding, { name: '导入的站点' })?.name).toBe('导入的站点')
  })
})

describe('migrateFromWebBuilderV1：脏数据收敛', () => {
  const page = migrateFromWebBuilderV1(legacyDirtyPage)!.pages[0]

  it('页名截断 40 字', () => {
    expect(page.name).toHaveLength(40)
  })

  it('hidden/locked 沿用 v1 的 Boolean 语义，进 meta', () => {
    expect(page.nodes.el1.meta.hidden).toBe(true)
    expect(page.nodes.el1.meta.locked).toBe(true)
    expect(page.nodes.el1.style.bg).toBe('#FFFFFF')
  })

  it('重复 id 改名，未知类型退化 rect，脏坐标尺寸被夹取', () => {
    const node = page.nodes.el1_2
    expect(node).toBeDefined()
    expect(node.type).toBe('rect')
    expect(node.layout.position).toEqual({ x: 20, y: 0 })
    expect(node.layout.size.w).toEqual({ kind: 'fixed', value: 1 })
    expect(node.layout.size.h).toEqual({ kind: 'fixed', value: 100 })
    expect(node.style.fontSize).toBe(100)
    expect(node.style.align).toBe('left')
    expect(node.props.text).toBe('123')
    expect(node.props.unknownKey).toBeUndefined()
  })
})

describe('migrateFromWebBuilderV1：多页与存档形状', () => {
  it('存档形状按 activePageId 定位当前页，首页路径 /，其余 /<pageId>', () => {
    const doc = migrateFromWebBuilderV1(legacyStorageShape)!
    expect(doc.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(doc.pages.map((p) => p.path)).toEqual(['/', '/p2'])
    expect(doc.activePageId).toBe('p2')
    expect(childrenOf(doc.pages[0].nodes, doc.pages[0].root)).toHaveLength(3)
  })

  it('activePageId 指向不存在的页时回到首页', () => {
    const doc = migrateFromWebBuilderV1({ pages: [{ id: 'p1' }, { id: 'p2' }], activePageId: 'ghost' })!
    expect(doc.activePageId).toBe('p1')
  })

  it('缺 id 的页面补 page_<n>，重复页 id 改名', () => {
    const doc = migrateFromWebBuilderV1({ pages: [{ elements: [] }, { id: 'p1' }, { id: 'p1' }] })!
    expect(doc.pages.map((p) => p.id)).toEqual(['page_1', 'p1', 'p1_2'])
    expect(doc.pages.map((p) => p.root)).toEqual(['root_page_1', 'root_p1', 'root_p1_2'])
  })
})

describe('migrateFromWebBuilderV1：视口与上限', () => {
  it('视口来自 viewport.w/h，其次 viewportW/H、curW/curH', () => {
    const fromViewport = migrateFromWebBuilderV1({
      pages: [{ id: 'p1', elements: [] }],
      viewport: { w: 375, h: 812 },
    })!
    expect(fromViewport.pages[0].viewport).toEqual({ w: 375, h: 812 })
    expect(fromViewport.pages[0].nodes.root_p1.layout.size).toEqual({
      w: { kind: 'fixed', value: 375 },
      h: { kind: 'fixed', value: 812 },
    })

    const fromCur = migrateFromWebBuilderV1({ pages: [{ id: 'p1', elements: [] }], curW: 1024, curH: 768 })!
    expect(fromCur.pages[0].viewport).toEqual({ w: 1024, h: 768 })
  })

  it('视口夹取到 200..10000', () => {
    const doc = migrateFromWebBuilderV1({
      pages: [{ id: 'p1', elements: [] }],
      viewport: { w: 100, h: 99_999 },
    })!
    expect(doc.pages[0].viewport).toEqual({ w: 200, h: 10_000 })
  })

  it('页数上限 50、每页元素上限 2000', () => {
    const manyPages = migrateFromWebBuilderV1(legacyManyPages(60, 3))!
    expect(manyPages.pages).toHaveLength(LEGACY_MAX_PAGES)

    const manyElements = migrateFromWebBuilderV1(legacyManyPages(1, LEGACY_MAX_ELEMENTS_PER_PAGE + 100))!
    expect(childrenOf(manyElements.pages[0].nodes, manyElements.pages[0].root)).toHaveLength(
      LEGACY_MAX_ELEMENTS_PER_PAGE,
    )
    expect(Object.keys(manyElements.pages[0].nodes)).toHaveLength(LEGACY_MAX_ELEMENTS_PER_PAGE + 1)
  })

  it('迁移后同一份输入总是序列化成同一份 JSON', () => {
    const first = migrateFromWebBuilderV1(legacyProductLanding, { name: 'x' })!
    const second = migrateFromWebBuilderV1(legacyProductLanding, { name: 'x' })!
    first.id = second.id
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

describe('parseImportedDoc：导入入口', () => {
  it('识别 v1 导出文件并标记已迁移', () => {
    const result = parseImportedDoc(JSON.stringify(legacyProductLanding))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFromV1).toBe(true)
    expect(result.doc.pages).toHaveLength(1)
  })

  it('容忍 BOM 前缀（v1 的导出文件带 BOM）', () => {
    const result = parseImportedDoc(`\uFEFF${JSON.stringify(legacyStorageShape)}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.activePageId).toBe('p2')
  })

  it('识别 v2 文档', () => {
    const result = parseImportedDoc(JSON.stringify(createDoc('我的站点')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFromV1).toBe(false)
    expect(result.doc.name).toBe('我的站点')
  })

  it('空文本 / 坏 JSON / 非对象分别给出可读错误', () => {
    expect(parseImportedDoc('   ')).toEqual({ ok: false, error: '文件是空的' })
    expect(parseImportedDoc('{')).toEqual({ ok: false, error: '不是合法的 JSON 文件' })
    const result = parseImportedDoc('42')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('不是有效的项目数据')
  })
})
