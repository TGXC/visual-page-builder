/**
 * 自定义组件的受限 DSL（M7 / 功能文档 AI5）。
 *
 * AI 与用户都**不允许**产出任意 JS/CSS：能被注册进组件库的只有这份 DSL ——
 * 「已注册组件的组合 + 受控样式白名单 + `{{prop}}` 文本占位符」。编译产物是一个
 * 普通 `ComponentDescriptor`：`toHtml()` 出类名化结构，`cssFor(scope)` 出作用域 CSS，
 * 所以自定义组件能和内置组件一样被拖入、导出、切断点。
 *
 * 纯逻辑（不碰 Vue / DOM / 网络），全部拒绝规则都可单测。
 */
import type { ComponentDescriptor, ComponentRenderContext } from '../components'
import { getComponent } from '../components'
import { escapeHtml } from '../html'

export interface DslNode {
  /** 必须是已注册且非 hidden 的组件类型（决定语义类 `el--<type>`） */
  type: string
  /** 文本内容，可含 `{{prop}}`；自动转义 */
  text?: string
  /** 受控样式（白名单键） */
  style?: Record<string, string | number>
  children?: DslNode[]
}

export interface DslProp {
  key: string
  label: string
  type: 'text' | 'number' | 'color'
  default: string | number
}

export interface ComponentDsl {
  name: string
  /** 面板图标（单字符 emoji/符号即可） */
  icon?: string
  size?: { w: number; h: number }
  props?: DslProp[]
  root: DslNode
}

export interface DslProblem {
  code: 'shape' | 'unknown-type' | 'depth' | 'size' | 'style' | 'placeholder'
  message: string
}

export const DSL_MAX_NODES = 30
export const DSL_MAX_DEPTH = 4
export const DSL_MAX_PROPS = 8
export const DSL_MAX_TEXT = 120

/** 样式白名单：只有这些键能进 CSS，值也按类型校验（因此不可能注入 url()/脚本） */
export const DSL_CSS_KEYS = {
  bg: 'color',
  color: 'color',
  borderColor: 'color',
  fontSize: 'number',
  fontWeight: 'number',
  radius: 'number',
  borderWidth: 'number',
  opacity: 'number',
  lineHeight: 'number',
  letterSpacing: 'number',
  padding: 'number',
  gap: 'number',
  width: 'number',
  height: 'number',
  align: 'enum',
  display: 'enum',
  flexDirection: 'enum',
  alignItems: 'enum',
  justifyContent: 'enum',
} as const

export type DslCssKey = keyof typeof DSL_CSS_KEYS

const ENUMS: Record<string, readonly string[]> = {
  align: ['left', 'center', 'right'],
  display: ['block', 'flex', 'inline-block', 'none'],
  flexDirection: ['row', 'column'],
  alignItems: ['flex-start', 'center', 'flex-end', 'stretch'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between'],
}

const CSS_PROP_NAMES: Record<DslCssKey, string> = {
  bg: 'background',
  color: 'color',
  borderColor: 'border-color',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  radius: 'border-radius',
  borderWidth: 'border-width',
  opacity: 'opacity',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  padding: 'padding',
  gap: 'gap',
  width: 'width',
  height: 'height',
  align: 'text-align',
  display: 'display',
  flexDirection: 'flex-direction',
  alignItems: 'align-items',
  justifyContent: 'justify-content',
}

const NUMBER_KEYS: readonly DslCssKey[] = ['fontSize', 'radius', 'borderWidth', 'padding', 'gap', 'width', 'height', 'letterSpacing']

const COLOR_PATTERN = /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|transparent|inherit)$/i
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 组件类型名：`custom-<ascii-slug>`。
 * 中文名字转不出 ASCII slug 时用确定性短哈希兜底 —— 类型名会进 CSS 类名与 HTML 标签属性，
 * 保持 ASCII 才不会在导出/第三方 CSS 工具链里出岔子；可读的名字留在 `label` / `aiDoc`。
 */
export function customTypeOf(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `custom-${ascii === '' ? hashOf(name.trim()) : ascii.slice(0, 24)}`
}

/** FNV-1a 短哈希（确定性，跨会话稳定） */
function hashOf(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 6)
}

function collect(node: unknown, depth: number, out: DslNode[], problems: DslProblem[]): void {
  if (!isRecord(node)) {
    problems.push({ code: 'shape', message: '节点必须是对象' })
    return
  }
  if (depth > DSL_MAX_DEPTH) {
    problems.push({ code: 'depth', message: `嵌套超过 ${DSL_MAX_DEPTH} 层` })
    return
  }
  out.push(node as unknown as DslNode)
  const children = node.children
  if (children === undefined) return
  if (!Array.isArray(children)) {
    problems.push({ code: 'shape', message: 'children 必须是数组' })
    return
  }
  for (const child of children) collect(child, depth + 1, out, problems)
}

function styleProblems(node: DslNode, problems: DslProblem[]): void {
  if (node.style === undefined) return
  if (!isRecord(node.style)) {
    problems.push({ code: 'style', message: 'style 必须是对象' })
    return
  }
  for (const [key, value] of Object.entries(node.style)) {
    if (!(key in DSL_CSS_KEYS)) {
      problems.push({ code: 'style', message: `样式键不在白名单：${key}` })
      continue
    }
    const kind = DSL_CSS_KEYS[key as DslCssKey]
    if (kind === 'color') {
      if (typeof value !== 'string' || !COLOR_PATTERN.test(value.trim())) {
        problems.push({ code: 'style', message: `颜色不合法：${key}=${String(value)}` })
      }
      continue
    }
    if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 2000) {
        problems.push({ code: 'style', message: `数值不合法：${key}=${String(value)}` })
      }
      continue
    }
    const allowed = ENUMS[key] ?? []
    if (typeof value !== 'string' || !allowed.includes(value)) {
      problems.push({ code: 'style', message: `${key} 只能是 ${allowed.join(' / ')}` })
    }
  }
}

function placeholderKeys(text: string): string[] {
  return [...text.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1].trim())
}

/** 校验一份 DSL：全部通过才允许编译注册 */
export function validateDsl(raw: unknown): DslProblem[] {
  const problems: DslProblem[] = []
  if (!isRecord(raw)) return [{ code: 'shape', message: 'DSL 必须是对象' }]
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name === '' || name.length > 24) problems.push({ code: 'shape', message: '名字必须是 1–24 个字' })
  const props: DslProp[] = []
  if (raw.props !== undefined) {
    if (!Array.isArray(raw.props)) {
      problems.push({ code: 'shape', message: 'props 必须是数组' })
    } else if (raw.props.length > DSL_MAX_PROPS) {
      problems.push({ code: 'shape', message: `props 最多 ${DSL_MAX_PROPS} 个` })
    } else {
      for (const item of raw.props) {
        if (!isRecord(item) || typeof item.key !== 'string' || !KEY_PATTERN.test(item.key)) {
          problems.push({ code: 'shape', message: 'prop 的 key 必须是字母开头的短标识符' })
          continue
        }
        if (item.type !== 'text' && item.type !== 'number' && item.type !== 'color') {
          problems.push({ code: 'shape', message: `prop ${item.key} 的类型只能是 text/number/color` })
          continue
        }
        props.push({
          key: item.key,
          label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim() : item.key,
          type: item.type,
          default: typeof item.default === 'number' ? item.default : String(item.default ?? ''),
        })
      }
    }
  }
  if (raw.size !== undefined) {
    if (!isRecord(raw.size) || typeof raw.size.w !== 'number' || typeof raw.size.h !== 'number') {
      problems.push({ code: 'size', message: 'size 必须是 { w, h } 数字' })
    }
  }
  if (raw.root === undefined) {
    problems.push({ code: 'shape', message: '缺少 root' })
    return problems
  }
  const nodes: DslNode[] = []
  collect(raw.root, 1, nodes, problems)
  if (nodes.length > DSL_MAX_NODES) {
    problems.push({ code: 'size', message: `节点数超过 ${DSL_MAX_NODES}` })
  }
  const declared = new Set(props.map((prop) => prop.key))
  for (const node of nodes) {
    const type = typeof node.type === 'string' ? node.type : ''
    const descriptor = getComponent(type)
    if (!descriptor || descriptor.hidden === true) {
      problems.push({ code: 'unknown-type', message: `未注册的组件类型：${type || '(空)'}` })
    }
    if (node.text !== undefined) {
      if (typeof node.text !== 'string') {
        problems.push({ code: 'shape', message: 'text 必须是字符串' })
      } else {
        if (node.text.length > DSL_MAX_TEXT) problems.push({ code: 'style', message: `文字超过 ${DSL_MAX_TEXT} 字` })
        for (const key of placeholderKeys(node.text)) {
          if (!declared.has(key)) problems.push({ code: 'placeholder', message: `占位符 {{${key}}} 没有对应的 prop` })
        }
      }
    }
    styleProblems(node, problems)
  }
  return problems
}

function styleDeclarations(style: Record<string, string | number> | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    if (!(key in DSL_CSS_KEYS)) continue
    const cssKey = key as DslCssKey
    const cssName = CSS_PROP_NAMES[cssKey]
    if (typeof value === 'number') {
      parts.push(`${cssName}:${NUMBER_KEYS.includes(cssKey) ? `${Math.round(value * 100) / 100}px` : value}`)
    } else {
      parts.push(`${cssName}:${value}`)
    }
  }
  return parts.join('; ')
}

function classOf(prefix: string, path: string): string {
  return `${prefix}-${path}`
}

function prefixOf(type: string): string {
  return `cc-${type.replace(/^custom-/, '').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '-')}`
}

function renderNode(node: DslNode, prefix: string, path: string, values: Record<string, string>): string {
  const text = (node.text ?? '').replace(/\{\{([^}]*)\}\}/g, (_match, key: string) => values[key.trim()] ?? '')
  const children = (node.children ?? []).map((child, index) => renderNode(child, prefix, `${path}-${index}`, values)).join('')
  return `<div class="${classOf(prefix, path)}">${escapeHtml(text)}${children}</div>`
}

function cssRules(node: DslNode, prefix: string, path: string, scope: string, out: string[]): void {
  const decls = styleDeclarations(node.style)
  if (decls !== '') out.push(`${scope} .${classOf(prefix, path)} { ${decls}; }`)
  for (const [index, child] of (node.children ?? []).entries()) {
    cssRules(child, prefix, `${path}-${index}`, scope, out)
  }
}

function toStringValues(descriptor: { props: DslProp[] }, ctx: ComponentRenderContext): Record<string, string> {
  const values: Record<string, string> = {}
  for (const prop of descriptor.props) {
    const raw = (ctx.node.props as Record<string, unknown>)[prop.key]
    values[prop.key] = String(raw === undefined || raw === null || raw === '' ? prop.default : raw)
  }
  return values
}

/** 编译成组件描述符（能被注册表接纳、能画布渲染、能导出） */
export function compileDsl(dsl: ComponentDsl): ComponentDescriptor {
  const type = customTypeOf(dsl.name)
  const prefix = prefixOf(type)
  const props = dsl.props ?? []
  const defaultProps = Object.fromEntries(props.map((prop) => [prop.key, prop.default]))
  return {
    type,
    label: dsl.name.trim(),
    category: 'custom',
    icon: dsl.icon ?? '✦',
    container: false,
    editable: false,
    defaultSize: dsl.size ?? { w: 240, h: 160 },
    defaultStyle: {},
    defaultProps,
    toHtml: (ctx) => renderNode(dsl.root, prefix, 'a', toStringValues({ props }, ctx)),
    toCanvasHtml: (ctx) => renderNode(dsl.root, prefix, 'a', toStringValues({ props }, ctx)),
    aiDoc: `我的组件（AI 生成）：${dsl.name.trim()}。属性：${
      props.map((prop) => `${prop.key}（${prop.label}）`).join('、') || '无'
    }`,
    overridable: props.map((prop) => prop.key),
    cssFor: (scope) => {
      const out: string[] = []
      cssRules(dsl.root, prefix, 'a', scope, out)
      return out.join('\n')
    },
  }
}

/** 预览用：把 DSL 渲染成一份能直接塞进 iframe 的独立 HTML */
export function componentPreviewHtml(dsl: ComponentDsl, background = '#F8FAFC'): string {
  const type = customTypeOf(dsl.name)
  const prefix = prefixOf(type)
  const props = dsl.props ?? []
  const values = Object.fromEntries(props.map((prop) => [prop.key, String(prop.default)]))
  const markup = renderNode(dsl.root, prefix, 'a', values)
  const rules: string[] = []
  cssRules(dsl.root, prefix, 'a', '.preview', rules)
  const size = dsl.size ?? { w: 240, h: 160 }
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>' + escapeHtml(dsl.name) + ' 预览</title>',
    '<style>',
    `body { margin:0; padding:24px; background:${background}; font-family:system-ui,-apple-system,"Segoe UI",sans-serif }`,
    `.preview { display:flex; align-items:flex-start; justify-content:center }`,
    `.preview > div { width:${size.w}px; min-height:${size.h}px; box-sizing:border-box }`,
    ...rules,
    '</style>',
    '</head>',
    '<body>',
    `<div class="preview">${markup}</div>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
