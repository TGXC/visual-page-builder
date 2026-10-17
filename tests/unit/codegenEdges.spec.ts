import { describe, expect, it } from 'vitest'
import {
  BASE_CSS,
  exportFileName,
  generateBodyHtml,
  generateHtml,
  generatePageCss,
  generateStandaloneHtml,
  generateVueSfc,
  inlineStyle,
  pageClassOf,
  pageSlug,
  slugOf,
} from '@/core/codegen'
import { buildSite } from '@/core/site'
import { makeDoc, makeNode, makeNodes, makePage } from './factories'

/**
 * M5 边角分支：防御性代码与兜底路径（覆盖率补充，同时也确认坏数据不会把导出打崩）。
 * 主路径的断言在 `codegenClass.spec.ts` / `responsiveExport.spec.ts`。
 */

/** 根节点缺失的页面（坏数据，导出要给出空串而不是抛错） */
function brokenDoc(): ReturnType<typeof makeDoc> {
  const page = makePage({
    id: 'page_broken',
    name: '坏页',
    root: 'missing_root',
    nodes: makeNodes([makeNode({ id: 'orphan', parentId: null, order: 0 })]),
  })
  return makeDoc({ id: 'doc_broken', name: '', pages: [page] })
}

function simpleDoc(name = '我的站点'): ReturnType<typeof makeDoc> {
  const page = makePage({
    id: 'page_1',
    name: '首页',
    nodes: makeNodes([
      makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 }),
      makeNode({ id: 'a', parentId: 'root', order: 0, props: { text: '内容' } }),
    ]),
  })
  return makeDoc({ id: 'doc_1', name, pages: [page] })
}

describe('M5 导出：slug 与文件名的兜底', () => {
  it('slugOf 全非法字符会得到空串，pageSlug 退回序号保证不空', () => {
    expect(slugOf('中文')).toBe('--')
    expect(slugOf('')).toBe('')
    expect(pageSlug(makePage({ id: '' }), 2)).toBe('page-3')
  })

  it('pageClassOf 对不在文档里的页面按序号 0 处理', () => {
    const stranger = makePage({ id: 'page_x' })
    expect(pageClassOf(simpleDoc(), stranger)).toBe('page-page_x')
  })

  it('exportFileName 清掉文件系统非法字符，空名回落到 studio-page', () => {
    expect(exportFileName(simpleDoc('a/b:c*d?e"f<g>h|i'))).toBe('a-b-c-d-e-f-g-h-i.html')
    expect(exportFileName(simpleDoc('   '), 'html')).toBe('studio-page.html')
  })
})

describe('M5 导出：坏数据与兜底路径', () => {
  it('根节点不存在时导出空串（generateHtml / standalone / Vue / body / css）', () => {
    const doc = brokenDoc()
    expect(generateBodyHtml(doc, 'page_broken')).toBe('')
    expect(generateHtml(doc, 'page_broken')).toBe('')
    expect(generateStandaloneHtml(doc, 'page_broken')).toBe('')
    expect(generateVueSfc(doc, 'page_broken')).toBe('')
    // 没有页面规则时仍然给出基础样式表，导出不会是空文件
    expect(generatePageCss(doc, 'page_broken')).toBe(BASE_CSS)
  })

  it('未知 pageKey 回落激活页，页面 root id 也能当 key', () => {
    const doc = simpleDoc()
    expect(generateBodyHtml(doc, '不存在的页')).toContain('data-page="page_1"')
    expect(generateBodyHtml(doc, 'root')).toContain('data-page="page_1"')
  })

  it('options.title 覆盖 SEO 标题', () => {
    const doc = simpleDoc()
    expect(generateHtml(doc, 'page_1', { title: '自定义标题' })).toContain('<title>自定义标题</title>')
  })

  it('standalone 标题链：SEO → 页面名 → 文档名', () => {
    const doc = simpleDoc('')
    doc.pages[0].name = ''
    expect(generateStandaloneHtml(doc, 'page_1')).toContain('<title></title>')
    doc.pages[0].name = '关于我们'
    expect(generateStandaloneHtml(doc, 'page_1')).toContain('<title>关于我们</title>')
  })

  it('Vue SFC 的组件名去掉非字母数字，全被去掉时回落到 StudioPage', () => {
    expect(generateVueSfc(simpleDoc(''), 'page_1')).toContain(`defineOptions({ name: 'StudioPagePage' })`)
    expect(generateVueSfc(simpleDoc('My Site'), 'page_1')).toContain(`defineOptions({ name: 'MySitePage' })`)
  })
})

describe('M5 导出：内联声明的兜底分支（画布与 CSS 共用）', () => {
  it('没有 box 且 size 没有值时宽度高度按 0 处理', () => {
    const node = makeNode({ id: 'a' })
    node.layout.size = { w: { kind: 'fixed' }, h: { kind: 'fixed' } }
    const style = inlineStyle(node)
    expect(style).toContain('width:0px')
    expect(style).toContain('height:0px')
  })

  it('边框与阴影没有颜色时用默认色', () => {
    const node = makeNode({ id: 'a' })
    node.style = { ...node.style, borderWidth: 2, shadowBlur: 4 }
    const style = inlineStyle(node)
    expect(style).toContain('border:2px solid #CBD5E1')
    expect(style).toContain('box-shadow:0px 0px 4px rgba(15,23,42,.18)')
  })

  it('更窄断点取消了某个声明时，媒体查询里写出复位值', () => {
    const doc = simpleDoc()
    const node = doc.pages[0].nodes.a
    node.style = { ...node.style, bg: '#ffffff' }
    node.overrides = { mobile: { style: { bg: '' } } }
    const css = generatePageCss(doc, 'page_1')
    expect(css).toMatch(/@media \(max-width: 767\.98px\)[\s\S]*\.n-a \{[^}]*background:none/)
  })

  it('画布内联样式与 CSS 规则对同一节点给出同样的盒', () => {
    const doc = simpleDoc()
    const node = doc.pages[0].nodes.a
    const inline = inlineStyle(node, '', { x: 5, y: 6, w: 7, h: 8 })
    const css = generatePageCss(doc, 'page_1', { a: { x: 5, y: 6, w: 7, h: 8 } })
    for (const decl of ['left:5px', 'top:6px', 'width:7px', 'height:8px']) {
      expect(inline).toContain(decl)
      expect(css).toContain(decl)
    }
  })
})

describe('M5 整站导出：空文档与激活页兜底', () => {
  it('没有页面时文件清单为空', () => {
    const doc = { ...simpleDoc(), pages: [] }
    expect(buildSite(doc)).toEqual([])
  })

  it('激活页 id 对不上时用第一个页面当 index.html', () => {
    const first = makePage({
      id: 'page_first',
      nodes: makeNodes([makeNode({ id: 'root', type: 'frame', parentId: null, order: 0 })]),
    })
    const doc = makeDoc({ pages: [first] })
    doc.activePageId = 'page_gone'
    const files = buildSite(doc)
    expect(files.map((file) => file.path)).toContain('index.html')
    expect(files.find((file) => file.path === 'index.html')?.content).toBe(
      files.find((file) => file.path === 'page_first.html')?.content,
    )
  })
})
