/**
 * 代码生成（M5）：把文档导出成「语义化 HTML + 独立 CSS 类」。
 *
 * M1 的策略是全内联样式（与 WebBuilder 一致，保证不倒退）；M5 起：
 * - 每个元素带 `el` / `el--<类型>` / `n-<id>` 三个类，几何与样式全部落进 CSS 规则；
 * - `generatePageCss()` 产出可独立发布的样式表，`generateHtml()` 把同一份 CSS 收进
 *   单个 `<style>` 块（双击即可打开），`buildSite()` 拆成多文件站点；
 * - 断点差异用 `@media` 覆盖同优先级的类规则（**不再需要 `!important`**，因为没有内联样式了）；
 * - 画布仍然用 `inlineStyle()`（Vue 组件要的就是内联盒），它和 CSS 走同一个 `declarations()`，
 *   所以「画布 ±1px」这条 M1 验收依然成立。
 */
import type { Box, Breakpoint, Doc, DocSeo, NodeId, Page, SceneNode } from '../schema/types'
import { computeLayout } from '../layout'
import { getComponent, renderContent } from '../components'
import { escapeHtml, safeUrl } from '../html'
import {
  breakpointViewport,
  effectivePage,
  mediaQueryForBreakpoint,
  orderedBreakpoints,
} from '../responsive'
import { childrenFrom, childrenIndex } from '../tree'
import {
  cssVarOf,
  isTokenRef,
  pageUsesTokens,
  resolveTokenValue,
  themeVariablesCss,
  tokenNameOf,
} from '../theme'

export { escapeHtml, safeUrl }

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

function resolvePage(doc: Doc, key: string): Page {
  return (
    doc.pages.find((page) => page.id === key) ??
    doc.pages.find((page) => page.root === key) ??
    doc.pages.find((page) => page.id === doc.activePageId) ??
    doc.pages[0]
  )
}

/** 类名片段：只留字母数字下划线短横线（非法字符逐个换成 `-`），保证是合法的 CSS 类名 */
export function slugOf(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

/** 节点的类名：`n-<id>` */
export function nodeClassOf(node: SceneNode): string {
  return `n-${slugOf(node.id)}`
}

/** 节点完整类名：`el el--<类型> n-<id>` */
export function classNamesOf(node: SceneNode): string {
  return `el el--${node.type} ${nodeClassOf(node)}`
}

/** 页面 slug：用页面 id（稳定、与改名无关），id 异常为空时退回序号 */
export function pageSlug(page: Page, index: number): string {
  const slug = slugOf(page.id)
  return slug === '' ? `page-${index + 1}` : slug
}

function pageIndex(doc: Doc, page: Page): number {
  const index = doc.pages.indexOf(page)
  return index < 0 ? 0 : index
}

/** 页面自身的选择器类名（`.page-<slug>`） */
export function pageClassOf(doc: Doc, page: Page): string {
  return `page-${pageSlug(page, pageIndex(doc, page))}`
}

/**
 * 声明生成的两个模式（M8）：画布要具体颜色，样式表要 `var(--token)` 引用。
 * `tokens` 缺省时按「没有主题」处理（引用解析成空 = 未设置）。
 */
interface DeclOptions {
  tokens?: Record<string, string>
  cssVars?: boolean
}

function paintOf(value: string, options?: DeclOptions): string {
  if (!isTokenRef(value)) return value
  const name = tokenNameOf(value)
  if (options?.cssVars) return cssVarOf(name)
  return options?.tokens ? resolveTokenValue(value, { tokens: options.tokens }) : ''
}

/**
 * 把节点渲染成声明列表（`prop:value`）。画布内联样式、页面 CSS、断点媒体查询共用它，
 * 这样三边不会出现「一个属性只有一边认识」的漂移。
 */
function declarations(node: SceneNode, backgroundImage: string, box?: Box, options?: DeclOptions): string[] {
  const { style, layout } = node
  const bg = paintOf(style.bg, options)
  const color = paintOf(style.color, options)
  const borderColor = paintOf(style.borderColor, options)
  const shadowColor = paintOf(style.shadowColor, options)
  const x = box ? box.x : layout.position.x
  const y = box ? box.y : layout.position.y
  const w = box ? box.w : (layout.size.w.value ?? 0)
  const h = box ? box.h : (layout.size.h.value ?? 0)
  const parts: string[] = [
    'position:absolute',
    `left:${px(x)}`,
    `top:${px(y)}`,
    `width:${px(w)}`,
    `height:${px(h)}`,
    'box-sizing:border-box',
  ]

  if (backgroundImage) {
    parts.push(`background-image:url(${backgroundImage})`, 'background-size:cover', 'background-position:center')
  } else if (bg) {
    parts.push(`background:${bg}`)
  }
  if (color) parts.push(`color:${color}`)
  if (style.fontSize > 0) parts.push(`font-size:${px(style.fontSize)}`)
  if (style.fontWeight > 0) parts.push(`font-weight:${style.fontWeight}`)
  if (style.align && style.align !== 'left') parts.push(`text-align:${style.align}`)
  if (style.radius > 0) parts.push(`border-radius:${px(style.radius)}`)
  if (style.borderWidth > 0) {
    parts.push(`border:${px(style.borderWidth)} solid ${borderColor || '#CBD5E1'}`)
  }
  if (style.opacity !== 1) parts.push(`opacity:${style.opacity}`)
  if (style.shadowBlur > 0 || style.shadowX !== 0 || style.shadowY !== 0) {
    parts.push(`box-shadow:${px(style.shadowX)} ${px(style.shadowY)} ${px(style.shadowBlur)} ${shadowColor || 'rgba(15,23,42,.18)'}`)
  }
  if (style.lineHeight > 0) parts.push(`line-height:${style.lineHeight}`)
  if (style.letterSpacing !== 0) parts.push(`letter-spacing:${px(style.letterSpacing)}`)
  if (node.meta.hidden) parts.push('display:none')

  return parts
}

function declarationMap(node: SceneNode, backgroundImage: string, box?: Box, options?: DeclOptions): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of declarations(node, backgroundImage, box, options)) {
    const index = part.indexOf(':')
    if (index > 0) map.set(part.slice(0, index), part.slice(index + 1))
  }
  return map
}

/** 某个声明在更窄断点被「取消」时，用它把值复位（媒体查询没有继承语义） */
const RESET_DECLARATIONS: Record<string, string> = {
  display: 'block',
  background: 'none',
  'background-image': 'none',
  'background-size': 'auto',
  'background-position': '0 0',
  color: 'inherit',
  'font-size': 'inherit',
  'font-weight': 'inherit',
  'text-align': 'inherit',
  'border-radius': '0',
  border: 'none',
  opacity: '1',
  'box-shadow': 'none',
  'line-height': 'inherit',
  'letter-spacing': 'normal',
}

/** 基础样式表：站点/单文件导出共用（`BASE_CSS` 之外的部分由每页的节点规则提供） */
export const BASE_CSS = [
  '* { margin: 0; padding: 0; }',
  'body { background: #f1f5f9; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }',
  '.page { position: relative; overflow: hidden; margin: 0 auto; }',
  '.el { position: absolute; box-sizing: border-box; overflow: hidden; }',
  '.el__muted { font-size: 0.9em; opacity: 0.65; }',
  '.el__title { font-size: 1.2em; font-weight: 600; }',
  '.el__caption { font-size: 12px; line-height: 1.4; opacity: 0.6; }',
  '.sub { font-size: 0.8em; opacity: 0.72; margin-top: 4px; }',
  'label { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; }',
  'select, input, textarea { width: 100%; height: 100%; font: inherit; color: inherit; border: none; background: transparent; }',
  'video { width: 100%; height: 100%; object-fit: cover; }',
  // M20：表格基础排版与编辑器的画布预览一致；th/td 必须继承 text-align，
  // 否则浏览器默认（th 居中、td 继承 table）会把「水平对齐」吃掉。
  '.el__table { width: 100%; border-collapse: collapse; }',
  '.el__table th, .el__table td { padding: 4px 8px; border: 1px solid #e2e8f0; text-align: inherit; }',
].join('\n')

/** 该断点下页面几何与有效节点（页面宽度换成断点自己的设计宽度） */
function pageAtBreakpoint(page: Page, breakpoints: readonly Breakpoint[], breakpoint: Breakpoint): Page {
  return { ...effectivePage(page, breakpoints, breakpoint.id), viewport: breakpointViewport(breakpoint) }
}

/**
 * 断点感知的 CSS：基准断点（最宽）不写媒体查询，其余断点各出一个
 * `@media (max-width: 上一级 minWidth - 0.02px)` 块，块里只写与**更宽一级**不同的声明。
 *
 * 选择器与基准规则同优先级且位置更靠后，所以顺序就能覆盖 —— 不再需要 `!important`
 * （M1 需要它，是因为当时样式内联在元素上）。
 */
export function generateResponsiveCss(doc: Doc, pageKey: string): string {
  const page = resolvePage(doc, pageKey)
  const ordered = orderedBreakpoints(doc.breakpoints)
  if (ordered.length <= 1) return ''
  const slug = pageClassOf(doc, page)
  const blocks: string[] = []
  const declOptions: DeclOptions = { tokens: doc.theme.tokens, cssVars: true }
  for (let index = 1; index < ordered.length; index += 1) {
    const breakpoint = ordered[index]
    const query = mediaQueryForBreakpoint(doc.breakpoints, breakpoint.id)
    if (!query) continue
    const current = pageAtBreakpoint(page, doc.breakpoints, breakpoint)
    const previous = pageAtBreakpoint(page, doc.breakpoints, ordered[index - 1])
    const currentBoxes = computeLayout({ nodes: current.nodes, rootId: current.root, viewport: current.viewport }).boxes
    const previousBoxes = computeLayout({ nodes: previous.nodes, rootId: previous.root, viewport: previous.viewport }).boxes
    const rules: string[] = [
      `  .${slug} { width:${px(current.viewport.w)}; height:${px(current.viewport.h)} }`,
    ]
    for (const id of Object.keys(current.nodes)) {
      if (id === page.root) continue
      const node = current.nodes[id]
      const before = previous.nodes[id]
      if (!node || !before) continue
      const currentDecls = declarationMap(node, backgroundImageOf(node), currentBoxes[id], declOptions)
      const previousDecls = declarationMap(before, backgroundImageOf(before), previousBoxes[id], declOptions)
      const parts: string[] = []
      for (const [prop, value] of currentDecls) {
        if (previousDecls.get(prop) !== value) parts.push(`${prop}:${value}`)
      }
      for (const prop of previousDecls.keys()) {
        if (!currentDecls.has(prop) && RESET_DECLARATIONS[prop]) {
          parts.push(`${prop}:${RESET_DECLARATIONS[prop]}`)
        }
      }
      if (parts.length > 0) rules.push(`  .${nodeClassOf(node)} { ${parts.join('; ')} }`)
    }
    blocks.push(`${query} {\n${rules.join('\n')}\n}`)
  }
  return blocks.join('\n')
}

/**
 * 单个页面的样式表：基础规则 + 每个节点的类规则 + 断点媒体查询。
 * 同一份文档重复生成结果完全一致（可复现，便于快照与体积对比）。
 */
export function generatePageCss(doc: Doc, pageKey: string, boxes?: Record<NodeId, Box>): string {
  const page = resolvePage(doc, pageKey)
  const root = page.nodes[page.root]
  if (!root) return BASE_CSS
  const layout = boxes ? { boxes } : computeLayout({ nodes: page.nodes, rootId: page.root, viewport: page.viewport })
  const options: DeclOptions = { tokens: doc.theme.tokens, cssVars: true }
  const rules: string[] = [BASE_CSS]
  // M8：只在页面真的引用主题 token 时产出 :root 变量块（否则导出结果与 M7 完全一致）
  if (pageUsesTokens(page)) {
    const variables = themeVariablesCss(doc.theme)
    if (variables !== '') rules.push(variables)
  }
  const pageBg = paintOf(root.style.bg, options)
  rules.push(
    `.${pageClassOf(doc, page)} { position:relative; width:${px(page.viewport.w)}; height:${px(page.viewport.h)}; overflow:hidden; margin:0 auto${pageBg ? `; background:${pageBg}` : ''} }`,
  )
  for (const id of Object.keys(page.nodes)) {
    if (id === page.root) continue
    const node = page.nodes[id]
    if (!node) continue
    const decls = declarations(node, backgroundImageOf(node), layout.boxes[id], options)
    rules.push(`.${nodeClassOf(node)} { ${decls.join('; ')} }`)
  }
  // M7 自定义组件：内部结构的样式由描述符自带（作用域限定在这一个实例的类名上）
  const custom: string[] = []
  for (const id of Object.keys(page.nodes)) {
    const node = page.nodes[id]
    if (!node || id === page.root) continue
    const descriptor = getComponent(node.type)
    if (!descriptor?.cssFor) continue
    const scoped = descriptor.cssFor(`.${nodeClassOf(node)}`)
    if (scoped.trim() !== '') custom.push(scoped)
  }
  if (custom.length > 0) rules.push(custom.join('\n'))
  const responsive = generateResponsiveCss(doc, page.id)
  if (responsive) rules.push(responsive)
  return rules.join('\n')
}

/** 完整样式表（默认导出当前页）：单文件 HTML 用它，`CodePanel` 也展示它 */
export function generateCss(doc: Doc, pageKey?: string, boxes?: Record<NodeId, Box>): string {
  return generatePageCss(doc, pageKey ?? doc.activePageId, boxes)
}

/** M1 的 base 依赖它：基础规则 + 语义类，不含节点规则 */
export function generateBaseCss(): string {
  return BASE_CSS
}

/**
 * 内联样式（画布用）。`box` 由布局引擎（`core/layout`）给出；不传时退回节点自己的
 * position/size，这样 M1 的自由布局行为不变，M2 起画布与导出都走同一份几何。
 */
export function inlineStyle(node: SceneNode, backgroundImage = '', box?: Box, tokens?: Record<string, string>): string {
  return declarations(node, backgroundImage, box, { tokens }).join(';')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function backgroundImageOf(node: SceneNode): string {
  if (node.type !== 'image') return ''
  return safeUrl(text(node.props.src))
}

function linkOf(node: SceneNode): string {
  return safeUrl(text(node.props.link))
}

function renderNode(
  node: SceneNode,
  nodes: Record<NodeId, SceneNode>,
  index: Map<NodeId | null, SceneNode[]>,
  indent: string,
  render: (node: SceneNode) => string,
): string {
  const children = childrenFrom(index, node.id)
  const body =
    renderContent(node, nodes) +
    children.map((child) => renderNode(child, nodes, index, indent, render)).join('')
  const link = linkOf(node)
  // link 类型自己就渲染 <a>，不要再套一层
  const inner = link && node.type !== 'link' ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${body}</a>` : body
  const tag = node.type === 'button' ? 'button' : 'div'
  const typeAttr = node.type === 'button' ? ' type="button"' : ''
  return `${indent}<${tag} class="${classNamesOf(node)}" data-id="${node.id}"${typeAttr}>${inner}</${tag}>`
}

/**
 * 页面内容 HTML（无样式属性，几何与样式都在 CSS 类里）。
 * M1 的 `boxes` 参数保留：调用方可以复用已经算好的布局结果（画布/预览），
 * 不传时这里自己按页面视口算一次 —— 两条路径的几何来自同一个引擎，误差才能是 0。
 */
export function generateBodyHtml(doc: Doc, pageKey: string, _boxes?: Record<NodeId, Box>): string {
  const page = resolvePage(doc, pageKey)
  const root = page.nodes[page.root]
  if (!root) return ''
  const index = childrenIndex(page.nodes)
  const inner = childrenFrom(index, page.root)
    .map((node) => renderNode(node, page.nodes, index, '', (child) => classNamesOf(child)))
    .join('\n')
  return `<div class="page ${pageClassOf(doc, page)}" data-page="${page.id}" data-id="${page.root}">\n${inner}\n</div>`
}

export interface CodegenOptions {
  /** 覆盖 `<title>`；默认用 `doc.seo.title`，再退回文档名 */
  title?: string
  /** 只输出页面主体（站点导出时样式走独立文件） */
  bodyOnly?: boolean
}

/** 站点头部元信息：`<!DOCTYPE html>` 之前的语言、标题与 SEO 标签 */
function headTags(doc: Doc, page: Page, options: CodegenOptions): string[] {
  const seo: DocSeo | undefined = doc.seo
  const title = options.title ?? (seo?.title || doc.name)
  const lang = seo?.lang || 'zh-CN'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    ...(seo?.description ? [`<meta name="description" content="${escapeHtml(seo.description)}">`] : []),
    ...(seo?.keywords ? [`<meta name="keywords" content="${escapeHtml(seo.keywords)}">`] : []),
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    ...(seo?.description ? [`<meta property="og:description" content="${escapeHtml(seo.description)}">`] : []),
    `<link rel="canonical" href="${escapeHtml(page.path || '/')}">`,
    '<style>',
  ]
}

function pageRoot(doc: Doc, pageKey: string): { page: Page; root: SceneNode } | null {
  const page = resolvePage(doc, pageKey)
  const root = page.nodes[page.root]
  return root ? { page, root } : null
}

/** 单文件 HTML：CSS 收进一个 `<style>` 块，双击即可打开 */
export function generateHtml(
  doc: Doc,
  pageKey: string,
  options: CodegenOptions = {},
  boxes?: Record<NodeId, Box>,
): string {
  const found = pageRoot(doc, pageKey)
  if (!found) return ''
  const { page } = found
  return [
    ...headTags(doc, page, options),
    generatePageCss(doc, page.id, boxes),
    '</style>',
    '</head>',
    '<body>',
    generateBodyHtml(doc, page.id, boxes),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** 站点分页 HTML：样式走外链（`buildSite()` 会一起产出 css 文件） */
export function generateStandaloneHtml(doc: Doc, pageKey: string, boxes?: Record<NodeId, Box>): string {
  const found = pageRoot(doc, pageKey)
  if (!found) return ''
  const { page } = found
  const slug = pageSlug(page, pageIndex(doc, page))
  return [
    `<!DOCTYPE html>`,
    `<html lang="${escapeHtml(doc.seo?.lang || 'zh-CN')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.seo?.title || page.name || doc.name)}</title>`,
    ...(doc.seo?.description ? [`<meta name="description" content="${escapeHtml(doc.seo.description)}">`] : []),
    '<link rel="stylesheet" href="base.css">',
    `<link rel="stylesheet" href="${slug}.css">`,
    '</head>',
    '<body>',
    generateBodyHtml(doc, page.id, boxes),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Vue 3 SFC 导出：`<template>` + 空 `<script setup>` + `<style scoped>`。
 * 类名与 HTML 导出一致，所以同一份设计两种产物可以互相对照。
 */
export function generateVueSfc(doc: Doc, pageKey: string, boxes?: Record<NodeId, Box>): string {
  const found = pageRoot(doc, pageKey)
  if (!found) return ''
  const { page, root } = found
  const name = (doc.name || 'StudioPage').replace(/[^a-zA-Z0-9]/g, '') || 'StudioPage'
  return [
    '<template>',
    generateBodyHtml(doc, page.id, boxes),
    '</template>',
    '',
    '<script setup lang="ts">',
    `// 由 Studio 导出：${escapeHtml(doc.name)} / ${escapeHtml(page.name)}（静态页面，无响应式状态）`,
    `// 根节点 ${escapeHtml(root.id)}，页面路径 ${escapeHtml(page.path || '/')}`,
    `defineOptions({ name: '${name}Page' })`,
    '</script>',
    '',
    '<style scoped>',
    generatePageCss(doc, page.id, boxes),
    '</style>',
    '',
  ].join('\n')
}

/** 导出文件名：取文档名，去掉文件系统不允许的字符 */
export function exportFileName(doc: Doc, extension = 'html'): string {
  const safe = doc.name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || 'studio-page'
  return `${safe}.${extension}`
}
