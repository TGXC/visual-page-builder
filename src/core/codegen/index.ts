/**
 * 代码生成：把文档导出成「可以双击打开的单个 HTML 文件」。
 *
 * M1 的策略是内联样式（与 WebBuilder 一致，保证不倒退）；M5 会升级成
 * 「语义化 HTML + 独立 CSS 类」，这里把差异隔离在 `generateCss` 与
 * `inlineStyle` 两个入口，避免到时候重写整条导出链路。
 */
import type { Box, Breakpoint, Doc, NodeId, Page, SceneNode } from '../schema/types'
import { computeLayout } from '../layout'
import {
  breakpointViewport,
  effectivePage,
  mediaQueryForBreakpoint,
  orderedBreakpoints,
} from '../responsive'
import { childrenOf } from '../tree'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 只放行 http/https、相对路径、页内锚点与**光栅图 dataURL**。
 * 导出文件会被用户直接打开，`javascript:` 与 `data:text/html` 必须拦掉；
 * 光栅图 dataURL 是本地文件通道（B16）的产物，图片上下文里不能执行脚本，故放行。
 */
export function safeUrl(url: string): string {
  const value = url.trim()
  if (value === '') return ''
  const lowered = value.toLowerCase()
  if (lowered.startsWith('javascript:') || lowered.startsWith('vbscript:')) return ''
  if (lowered.startsWith('data:')) {
    // 只认 data:image/<光栅格式>;base64,，SVG 能内嵌脚本，不放行。
    return /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(value) ? value : ''
  }
  if (/^(https?:)?\/\//.test(lowered) || lowered.startsWith('/') || lowered.startsWith('#') || lowered.startsWith('./')) {
    return value
  }
  // 形如 `a.png` 的相对路径也放行，但绝不放行任何带协议的其它写法
  return /^[a-z][a-z0-9+.-]*:/i.test(lowered) ? '' : value
}

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

/**
 * 把节点渲染成声明列表（`prop:value`）。`inlineStyle` 与断点媒体查询共用它，
 * 这样两边不会出现「一个属性只有一边认识」的漂移。
 */
function declarations(node: SceneNode, backgroundImage: string, box?: Box): string[] {
  const { style, layout } = node
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
  } else if (style.bg) {
    parts.push(`background:${style.bg}`)
  }
  if (style.color) parts.push(`color:${style.color}`)
  if (style.fontSize > 0) parts.push(`font-size:${px(style.fontSize)}`)
  if (style.fontWeight > 0) parts.push(`font-weight:${style.fontWeight}`)
  if (style.align && style.align !== 'left') parts.push(`text-align:${style.align}`)
  if (style.radius > 0) parts.push(`border-radius:${px(style.radius)}`)
  if (style.borderWidth > 0) {
    parts.push(`border:${px(style.borderWidth)} solid ${style.borderColor || '#CBD5E1'}`)
  }
  if (style.opacity !== 1) parts.push(`opacity:${style.opacity}`)
  if (style.shadowBlur > 0 || style.shadowX !== 0 || style.shadowY !== 0) {
    parts.push(`box-shadow:${px(style.shadowX)} ${px(style.shadowY)} ${px(style.shadowBlur)} ${style.shadowColor || 'rgba(15,23,42,.18)'}`)
  }
  if (style.lineHeight > 0) parts.push(`line-height:${style.lineHeight}`)
  if (style.letterSpacing !== 0) parts.push(`letter-spacing:${px(style.letterSpacing)}`)
  if (node.meta.hidden) parts.push('display:none')

  return parts
}

function declarationMap(node: SceneNode, backgroundImage: string, box?: Box): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of declarations(node, backgroundImage, box)) {
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

/** 该断点下页面几何与有效节点（页面宽度换成断点自己的设计宽度） */
function pageAtBreakpoint(page: Page, breakpoints: readonly Breakpoint[], breakpoint: Breakpoint): Page {
  return { ...effectivePage(page, breakpoints, breakpoint.id), viewport: breakpointViewport(breakpoint) }
}

/**
 * 断点感知的 CSS：基准断点（最宽）不写媒体查询，其余断点各出一个
 * `@media (max-width: 上一级 minWidth - 0.02px)` 块，块里只写与**更宽一级**
 * 不同的声明，并用 `!important` 压过元素上的内联样式（内联样式优先级最高）。
 */
export function generateResponsiveCss(doc: Doc, pageKey: string): string {
  const page = resolvePage(doc, pageKey)
  const ordered = orderedBreakpoints(doc.breakpoints)
  if (ordered.length <= 1) return ''
  const blocks: string[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    const breakpoint = ordered[index]
    const query = mediaQueryForBreakpoint(doc.breakpoints, breakpoint.id)
    if (!query) continue
    const current = pageAtBreakpoint(page, doc.breakpoints, breakpoint)
    const previous = pageAtBreakpoint(page, doc.breakpoints, ordered[index - 1])
    const currentBoxes = computeLayout({ nodes: current.nodes, rootId: current.root, viewport: current.viewport }).boxes
    const previousBoxes = computeLayout({ nodes: previous.nodes, rootId: previous.root, viewport: previous.viewport }).boxes
    const rules: string[] = [
      `  .page[data-id="${page.root}"] { width:${px(current.viewport.w)} !important; height:${px(current.viewport.h)} !important }`,
    ]
    for (const id of Object.keys(current.nodes)) {
      if (id === page.root) continue
      const node = current.nodes[id]
      const before = previous.nodes[id]
      if (!node || !before) continue
      const currentDecls = declarationMap(node, backgroundImageOf(node), currentBoxes[id])
      const previousDecls = declarationMap(before, backgroundImageOf(before), previousBoxes[id])
      const parts: string[] = []
      for (const [prop, value] of currentDecls) {
        if (previousDecls.get(prop) !== value) parts.push(`${prop}:${value} !important`)
      }
      for (const prop of previousDecls.keys()) {
        if (!currentDecls.has(prop) && RESET_DECLARATIONS[prop]) {
          parts.push(`${prop}:${RESET_DECLARATIONS[prop]} !important`)
        }
      }
      if (parts.length > 0) rules.push(`  .el[data-id="${id}"] { ${parts.join('; ')} }`)
    }
    blocks.push(`${query} {\n${rules.join('\n')}\n}`)
  }
  return blocks.join('\n')
}

/**
 * 内联样式。`box` 由布局引擎（`core/layout`）给出；不传时退回节点自己的 position/size，
 * 这样 M1 的自由布局行为不变，M2 起画布与导出都走同一份几何。
 */
export function inlineStyle(node: SceneNode, backgroundImage = '', box?: Box): string {
  return declarations(node, backgroundImage, box).join(';')
}


function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function optionsOf(raw: unknown): string[] {
  return text(raw)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function contentHtml(node: SceneNode): string {
  const props = node.props
  const label = text(props.text)
  switch (node.type) {
    case 'header':
    case 'card':
      return [label, props.sub ? `<div class="sub">${escapeHtml(text(props.sub))}</div>` : ''].join('')
    case 'button':
      return escapeHtml(label)
    case 'input':
      return `<input type="text" placeholder="${escapeHtml(text(props.placeholder))}">`
    case 'textarea':
      return `<textarea placeholder="${escapeHtml(text(props.placeholder))}"></textarea>`
    case 'select': {
      const options = optionsOf(props.text)
      const head = props.placeholder ? `<option value="">${escapeHtml(text(props.placeholder))}</option>` : ''
      return `<select>${head}${options.map((item) => `<option>${escapeHtml(item)}</option>`).join('')}</select>`
    }
    case 'checkbox':
    case 'radio':
      return optionsOf(props.text)
        .map((item) => `<label><input type="${node.type}">${escapeHtml(item)}</label>`)
        .join('')
    case 'video': {
      const src = safeUrl(text(props.src))
      return src ? `<video src="${escapeHtml(src)}" controls></video>` : escapeHtml(label)
    }
    case 'image': {
      const src = safeUrl(text(props.src))
      return src ? '' : escapeHtml(label)
    }
    case 'divider':
      return ''
    default:
      return escapeHtml(label)
  }
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
  indent: string,
  boxes?: Record<NodeId, Box>,
): string {
  const children = childrenOf(nodes, node.id)
  const image = backgroundImageOf(node)
  const body = contentHtml(node) + children.map((child) => renderNode(child, nodes, indent, boxes)).join('')
  const link = linkOf(node)
  const inner = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${body}</a>` : body
  const tag = node.type === 'button' ? 'button' : 'div'
  const typeAttr = node.type === 'button' ? ' type="button"' : ''
  const style = inlineStyle(node, image, boxes ? boxes[node.id] : undefined)
  return `${indent}<${tag} class="el el--${node.type}" data-id="${node.id}"${typeAttr} style="${style}">${inner}</${tag}>`
}

/**
 * 页面内容 HTML。`boxes` 可复用调用方已经算好的布局结果（画布/预览），
 * 不传时这里自己按页面视口算一次——两条路径的几何来自同一个引擎，误差才能是 0。
 */
export function generateBodyHtml(doc: Doc, pageKey: string, boxes?: Record<NodeId, Box>): string {
  const page = resolvePage(doc, pageKey)
  const root = page.nodes[page.root]
  if (!root) return ''
  const layout = boxes
    ? { boxes }
    : computeLayout({ nodes: page.nodes, rootId: page.root, viewport: page.viewport })
  const inner = childrenOf(page.nodes, page.root)
    .map((node) => renderNode(node, page.nodes, '', layout.boxes))
    .join('\n')
  const pageStyle = [
    'position:relative',
    `width:${px(page.viewport.w)}`,
    `height:${px(page.viewport.h)}`,
    'overflow:hidden',
    'margin:0 auto',
    root.style.bg ? `background:${root.style.bg}` : '',
  ]
    .filter(Boolean)
    .join(';')
  return `<div class="page" data-id="${page.root}" data-page="${page.id}" style="${pageStyle}">\n${inner}\n</div>`
}

/** M1：样式内联在元素上；M5 会换成独立 CSS 文件，这里先给出说明 */
export function generateCss(_doc: Doc): string {
  return '/* M1：样式已内联在每个元素的 style 属性中，无需单独 CSS 文件；M5 将升级为独立 CSS 类。 */'
}

export interface CodegenOptions {
  /** 覆盖 <title>；默认用文档名 */
  title?: string
}

export function generateHtml(
  doc: Doc,
  pageKey: string,
  options: CodegenOptions = {},
  boxes?: Record<NodeId, Box>,
): string {
  const page = resolvePage(doc, pageKey)
  const title = options.title ?? doc.name
  const responsive = generateResponsiveCss(doc, page.id)
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${generateCss(doc)}</style>`,
    ...(responsive ? ['<style>', responsive, '</style>'] : []),
    '<style>',
    '  * { margin: 0; padding: 0; }',
    '  body { background: #f1f5f9; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }',
    '  .page .el { overflow: hidden; }',
    '  .page .sub { font-size: 0.8em; opacity: 0.72; margin-top: 4px; }',
    '  .page label { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; }',
    '  .page select, .page input, .page textarea { width: 100%; height: 100%; font: inherit; color: inherit; border: none; background: transparent; }',
    '  .page video { width: 100%; height: 100%; object-fit: cover; }',
    '</style>',
    '</head>',
    '<body>',
    generateBodyHtml(doc, page.id, boxes),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** 导出文件名：取文档名，去掉文件系统不允许的字符 */
export function exportFileName(doc: Doc, extension = 'html'): string {
  const safe = doc.name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || 'studio-page'
  return `${safe}.${extension}`
}
