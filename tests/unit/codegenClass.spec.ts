import { describe, expect, it } from 'vitest'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import {
  BASE_CSS,
  classNamesOf,
  generateBodyHtml,
  generateCss,
  generateHtml,
  generatePageCss,
  generateVueSfc,
  slugOf,
} from '@/core/codegen'
import { buildSite, pageSlug } from '@/core/site'
import { createZip, crc32 } from '@/core/zip'
import { normalizeDoc } from '@/core/schema/normalize'
import { makeDoc, makeNode, makeNodes, makePage } from './factories'

/**
 * M5：导出从「全内联样式」升级成「语义化 HTML + 独立 CSS 类」。
 *
 * 判据（PLAN.md M5）：导出 HTML 无内联样式堆叠、类名可读、能被真实 Vue 项目引用。
 */

function page(): ReturnType<typeof makePage> {
  return makePage({
    id: 'page_home',
    name: '首页',
    path: '/',
    root: 'root',
    viewport: { w: 1200, h: 800 },
    nodes: makeNodes([
      makeNode({
        id: 'root',
        type: 'frame',
        parentId: null,
        order: 0,
        props: { text: '' },
        style: { ...makeNode({ id: 'x' }).style, bg: '#ffffff' },
        layout: {
          ...makeNode({ id: 'x' }).layout,
          size: { w: { kind: 'fixed', value: 1200 }, h: { kind: 'fixed', value: 800 } },
        },
      }),
      makeNode({
        id: 'text_1',
        type: 'text',
        parentId: 'root',
        order: 0,
        props: { text: '欢迎' },
        style: { ...makeNode({ id: 'x' }).style, color: '#111111', fontSize: 20 },
      }),
      makeNode({
        id: 'image_1',
        type: 'image',
        parentId: 'root',
        order: 1,
        props: { src: 'https://a.example/p.png', text: '' },
      }),
      makeNode({ id: 'hidden_1', type: 'rect', parentId: 'root', order: 2, meta: { name: '', locked: false, hidden: true } }),
    ]),
  })
}

function doc(): ReturnType<typeof makeDoc> {
  return makeDoc({ id: 'doc_1', name: '我的站点', pages: [page()] })
}

describe('M5 代码生成：类名化 CSS，无内联样式', () => {
  it('元素带可读类名（el / el--类型 / n-id），HTML 里不再有 style 属性', () => {
    const html = generateBodyHtml(doc(), 'page_home')
    expect(html).toContain('class="el el--text n-text_1"')
    expect(html).toContain('class="el el--image n-image_1"')
    expect(html).not.toContain('style="')
    expect(html).not.toContain('position:absolute')
  })

  it('几何与样式落到 CSS 类规则里，值与布局盒一致', () => {
    const css = generatePageCss(doc(), 'page_home')
    expect(css).toContain('.el {')
    expect(css).toContain('.n-text_1 {')
    expect(css).toContain('position:absolute')
    expect(css).toContain('left:0px')
    expect(css).toContain('color:#111111')
    expect(css).toContain('font-size:20px')
    // 隐藏节点在 CSS 里 display:none（而不是内联）
    expect(css).toMatch(/\.n-hidden_1 \{[^}]*display:none/)
    // 相对路径的页面：图片背景在 CSS 里
    expect(css).toMatch(/\.n-image_1 \{[^}]*background-image:url\(https:\/\/a\.example\/p\.png\)/)
    // 页面自身规则（宽度/高度）
    expect(css).toContain(`.page-${pageSlug(page(), 0)} {`)
  })

  it('generateCss 与 generatePageCss 一致，且同一文档重复生成完全一致（确定性）', () => {
    expect(generateCss(doc(), 'page_home')).toBe(generateCss(doc(), 'page_home'))
    expect(generateCss(doc(), 'page_home')).toBe(generatePageCss(doc(), 'page_home'))
    expect(BASE_CSS).toContain('.el {')
  })

  it('生成的 CSS 不含 !important（内联样式已取消，媒体查询靠顺序覆盖）', () => {
    const state = doc()
    state.pages[0].nodes.text_1.overrides = {
      mobile: { style: { fontSize: 14 } },
    }
    const css = generatePageCss(state, 'page_home')
    expect(css).toContain('@media (max-width: 767.98px)')
    expect(css).not.toContain('!important')
  })

  it('断点媒体查询改写节点类与页面类', () => {
    const state = doc()
    state.pages[0].nodes.text_1.overrides = { mobile: { style: { fontSize: 14 } } }
    const css = generatePageCss(state, 'page_home')
    const media = css.slice(css.indexOf('@media'))
    expect(media).toContain('.n-text_1')
    expect(media).toContain('font-size:14px')
    expect(media).toContain(`.page-${pageSlug(state.pages[0], 0)}`)
    expect(media).toContain('width:375px')
  })

  it('slugOf 把非法字符换成短横线，页面 slug 稳定且不重复', () => {
    expect(slugOf('text_1')).toBe('text_1')
    expect(slugOf('node/2 号')).toBe('node-2--')
    const pages = [page(), makePage({ id: 'page_2', name: '关于我们', path: '/about' })]
    expect(pageSlug(pages[0], 0)).toBe('page_home')
    expect(pageSlug(pages[1], 1)).toBe('page_2')
    expect(classNamesOf(pages[0].nodes.text_1)).toBe('el el--text n-text_1')
  })

  it('单文件 HTML 把 CSS 收进一个 <style> 块，可以直接双击打开', () => {
    const html = generateHtml(doc(), 'page_home')
    expect(html).toContain('<style>')
    expect(html).toContain('.n-text_1 {')
    expect(html).toContain('@media (max-width: 767.98px)')
    expect(html).not.toContain('style="')
  })

  it('SEO 元信息写进 head，缺省时给出安全默认值', () => {
    const state = normalizeDoc({
      ...doc(),
      seo: { title: '  我的首页  ', description: '一段介绍', lang: 'en', keywords: 'a, b' },
    }) ?? doc()
    const html = generateHtml(state, 'page_home')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>我的首页</title>')
    expect(html).toContain('<meta name="description" content="一段介绍">')
    expect(html).toContain('<meta name="keywords" content="a, b">')

    const bare = generateHtml(doc(), 'page_home')
    expect(bare).toContain('<html lang="zh-CN">')
    expect(bare).toContain(`<title>${doc().name}</title>`)
  })

  it('Vue 3 SFC 导出：template + scoped style，类名与 HTML 一致', () => {
    const sfc = generateVueSfc(doc(), 'page_home')
    expect(sfc).toContain('<template>')
    expect(sfc).toContain('class="page page-page_home"')
    expect(sfc).toContain('class="el el--text n-text_1"')
    expect(sfc).toContain('<style scoped>')
    expect(sfc).toContain('.n-text_1 {')
    expect(sfc).toContain('</template>')
    expect(sfc).not.toContain('style="')
  })

  it('Vue SFC 能被 @vue/compiler-sfc 编译（真实 Vue 项目可直接引用）', () => {
    const sfc = generateVueSfc(doc(), 'page_home')
    const { descriptor, errors } = parse(sfc, { filename: 'StudioPage.vue' })
    expect(errors).toEqual([])
    expect(descriptor.template).toBeTruthy()
    const template = compileTemplate({
      source: descriptor.template?.content ?? '',
      filename: 'StudioPage.vue',
      id: 'studio-page',
    })
    expect(template.errors).toEqual([])
    const script = compileScript(descriptor, { id: 'studio-page' })
    expect(script.content).toContain('StudioPagePage')
  })
  it('单文件 HTML 关键结构快照（M5 验收：快照测试）', () => {
    // 固定 id 的 fixture，因此快照完全确定；结构变了必须显式更新快照文件
    expect(generateHtml(doc(), 'page_home')).toMatchSnapshot()
    expect(generateCss(doc(), 'page_home')).toMatchSnapshot()
  })
})

describe('M5 静态站点与 zip 打包', () => {
  it('buildSite 产出 index.html + 每页 html/css + base.css', () => {
    const state = doc()
    state.pages.push(
      makePage({ id: 'page_about', name: '关于', path: '/about', root: 'root_about', nodes: makeNodes([makeNode({ id: 'root_about', type: 'frame', parentId: null, order: 0 })]) }),
    )
    const files = buildSite(state)
    const paths = files.map((file) => file.path)
    expect(paths).toContain('index.html')
    expect(paths).toContain('base.css')
    expect(paths).toContain('page_home.html')
    expect(paths).toContain('page_home.css')
    expect(paths).toContain('page_about.html')
    expect(paths).toContain('page_about.css')

    const index = files.find((file) => file.path === 'index.html')
    // index.html 就是当前激活页面的拷贝
    expect(index?.content).toBe(files.find((file) => file.path === 'page_home.html')?.content)
    const about = files.find((file) => file.path === 'page_about.html')
    expect(about?.content).toContain('href="base.css"')
    expect(about?.content).toContain('href="page_about.css"')
    expect(about?.content).not.toContain('style="')
  })

  it('crc32 与 zip 打包：条目名（含中文）、大小与数据都能读回来', () => {
    const encoder = new TextEncoder()
    expect(crc32(encoder.encode('hello'))).toBe(0x3610a686)

    const files = [
      { path: 'index.html', content: '<html>你好</html>' },
      { path: '页面 2.html', content: 'second' },
    ]
    const zip = createZip(files)
    // 本地文件头签名
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    // 中央目录与结尾记录
    expect(zip.length).toBeGreaterThan(60)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    let offset = 0
    const names: string[] = []
    while (view.getUint32(offset, true) === 0x04034b50) {
      const crc = view.getUint32(offset + 14, true)
      const size = view.getUint32(offset + 18, true)
      const nameLength = view.getUint16(offset + 26, true)
      const extraLength = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + nameLength))
      const data = zip.slice(offset + 30 + nameLength + extraLength, offset + 30 + nameLength + extraLength + size)
      expect(crc).toBe(crc32(data))
      expect(name).toBe(files[names.length].path)
      expect(new TextDecoder().decode(data)).toBe(files[names.length].content)
      names.push(name)
      offset += 30 + nameLength + extraLength + size
    }
    expect(names).toEqual(['index.html', '页面 2.html'])
    // 结尾记录：条目数
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2)
  })

  it('空清单也产出合法 zip', () => {
    const zip = createZip([])
    expect(zip.length).toBe(22)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x06054b50)
    expect(view.getUint16(10, true)).toBe(0)
  })
})
