/**
 * 整站导出（M5）：把文档拆成「解压即可打开」的静态站点。
 *
 * 产物固定为：
 * - `index.html` —— 当前激活页的拷贝（放到任何静态服务器根目录就能访问）
 * - `base.css` —— 基础规则（`BASE_CSS`）
 * - `<页面 slug>.html` / `<页面 slug>.css` —— 每页一份，HTML 用 `<link>` 引两个样式表
 *
 * 所有文件内容都来自 `core/codegen` 的同一批纯函数，所以单文件导出与整站导出的
 * 类名、几何、媒体查询完全一致（`core/codegen` 的 `generateStandaloneHtml` 负责 HTML）。
 */
import type { Box, Doc, NodeId, Page } from '../schema/types'
import {
  BASE_CSS,
  generatePageCss,
  generateStandaloneHtml,
  pageSlug,
} from '../codegen'

export interface SiteFile {
  path: string
  content: string
}

export { pageSlug }

/** 每页的 slug：用页面 id（与改名无关），异常 id 退回序号 */
function slugsOf(doc: Doc): Map<string, string> {
  const map = new Map<string, string>()
  doc.pages.forEach((page, index) => {
    map.set(page.id, pageSlug(page, index))
  })
  return map
}

/**
 * 生成整站文件清单。顺序固定（index / base.css / 各页 html+css），便于快照比对。
 * `boxes` 可以传「当前画布已经算好的布局」，不传时各页自己算（两条路径同一个引擎）。
 */
export function buildSite(doc: Doc, boxes?: Record<NodeId, Box>): SiteFile[] {
  const files: SiteFile[] = []
  const active = doc.pages.find((page) => page.id === doc.activePageId) ?? doc.pages[0]
  if (!active || doc.pages.length === 0) return files
  const slugs = slugsOf(doc)

  // index.html 就是激活页的拷贝：算一次两处复用（M8 性能：整站导出不再重复渲染激活页）
  const activeHtml = generateStandaloneHtml(doc, active.id, boxes)
  files.push({ path: 'index.html', content: activeHtml })
  files.push({ path: 'base.css', content: BASE_CSS })

  const pages: Page[] = doc.pages
  pages.forEach((page, index) => {
    const slug = slugs.get(page.id) ?? pageSlug(page, index)
    // 传进来的 boxes 只对当前激活页有效（调用方只算了那一页），其余页让 codegen 自己算
    const pageBoxes = page.id === active.id ? boxes : undefined
    const html = page.id === active.id ? activeHtml : generateStandaloneHtml(doc, page.id, pageBoxes)
    files.push({ path: `${slug}.html`, content: html })
    files.push({ path: `${slug}.css`, content: generatePageCss(doc, page.id, pageBoxes) })
  })

  return files
}
