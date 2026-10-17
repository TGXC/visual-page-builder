/**
 * M8 主题 token（功能文档 L7「主题（Design Tokens）」）。
 *
 * 约定：受控样式里的**字符串字段**（`bg` / `color` / `borderColor` / `shadowColor`）
 * 可以写成 `$<token 名>` 的引用；导出时编译成 `var(--<token 名>)`，整份样式表带一个
 * `:root{...}` 变量块（只在页面真的引用 token 时才产出，避免平白改变既有输出）；
 * 画布则当场解析成具体值（拖动、命中测试、PNG 截图都按真实颜色走）。
 *
 * 数字字段（`fontSize` / `radius` / `spacing` 等）在 `StyleSpec` 里是 `number`，
 * 这轮不做引用 —— 见 D51 的取舍说明。
 */
import type { Doc, Page, SceneNode, StyleSpec, Theme } from '../schema/types'

export const TOKEN_PREFIX = '$'

const TOKEN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export interface ThemeTokenGroup {
  id: string
  label: string
  kind: 'color' | 'text'
}

/** 主题面板的分组顺序（前缀匹配：`color-primary` 属于 `color` 组） */
export const TOKEN_GROUPS: readonly ThemeTokenGroup[] = [
  { id: 'color', label: '颜色', kind: 'color' },
  { id: 'font-size', label: '字号', kind: 'text' },
  { id: 'space', label: '间距', kind: 'text' },
  { id: 'radius', label: '圆角', kind: 'text' },
  { id: 'shadow', label: '阴影', kind: 'text' },
]

export const OTHER_TOKEN_GROUP: ThemeTokenGroup = { id: 'other', label: '其他', kind: 'text' }

export function groupOfToken(name: string): ThemeTokenGroup {
  const found = TOKEN_GROUPS.find((group) => name === group.id || name.startsWith(`${group.id}-`))
  return found ?? OTHER_TOKEN_GROUP
}

/** `$color-primary` 这种引用形态（其它一律当普通样式值） */
export function isTokenRef(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(TOKEN_PREFIX)) return false
  return TOKEN_NAME_PATTERN.test(value.slice(TOKEN_PREFIX.length))
}

export function tokenNameOf(value: string): string {
  return value.startsWith(TOKEN_PREFIX) ? value.slice(TOKEN_PREFIX.length) : value
}

export function tokenRef(name: string): string {
  return `${TOKEN_PREFIX}${name}`
}

export function tokenValue(theme: Theme, name: string): string | undefined {
  return theme.tokens[name]
}

/** 解析单个样式值：非引用原样返回，引用取主题里的值（缺失用 `fallback`） */
export function resolveTokenValue(value: string, theme: Theme, fallback = ''): string {
  if (!isTokenRef(value)) return value
  return theme.tokens[tokenNameOf(value)] ?? fallback
}

/** 画布用的具体样式：把四个字符串字段里的 token 引用解析掉 */
export function resolveStyle(style: StyleSpec, theme: Theme): StyleSpec {
  return {
    ...style,
    bg: resolveTokenValue(style.bg, theme),
    color: resolveTokenValue(style.color, theme),
    borderColor: resolveTokenValue(style.borderColor, theme),
    shadowColor: resolveTokenValue(style.shadowColor, theme),
  }
}

export function cssVarOf(name: string): string {
  return `var(--${name})`
}

/** `:root{--a:b;--c:d}`（空主题给空串），键序按名字排序保证可复现 */
export function themeVariablesCss(theme: Theme): string {
  const names = Object.keys(theme.tokens).sort()
  if (names.length === 0) return ''
  return `:root{${names.map((name) => `--${name}:${theme.tokens[name]}`).join(';')}}`
}

function styleRefs(style: Partial<StyleSpec> | undefined): boolean {
  if (!style) return false
  return (
    isTokenRef(style.bg) || isTokenRef(style.color) || isTokenRef(style.borderColor) || isTokenRef(style.shadowColor)
  )
}

export function nodeUsesTokens(node: SceneNode): boolean {
  if (styleRefs(node.style)) return true
  return Object.values(node.overrides).some((override) => styleRefs(override.style))
}

export function pageUsesTokens(page: Page): boolean {
  return Object.values(page.nodes).some((node) => nodeUsesTokens(node))
}

export function docUsesTokens(doc: Doc): boolean {
  return doc.pages.some((page) => pageUsesTokens(page))
}

/** 引用了但主题里没有的 token（去重后排序），面板用它报「引用失效」 */
export function missingTokenRefs(page: Page, theme: Theme): string[] {
  const found = new Set<string>()
  for (const node of Object.values(page.nodes)) {
    for (const style of [node.style, ...Object.values(node.overrides).map((override) => override.style)]) {
      if (!style) continue
      for (const value of [style.bg, style.color, style.borderColor, style.shadowColor]) {
        if (isTokenRef(value) && theme.tokens[tokenNameOf(value)] === undefined) found.add(value)
      }
    }
  }
  return [...found].sort()
}

export interface ThemeTokenEntry {
  name: string
  value: string
  group: ThemeTokenGroup
}

/** 主题面板的列表数据：按组顺序、组内按名字排序 */
export function themeTokenEntries(theme: Theme): ThemeTokenEntry[] {
  const groups = [...TOKEN_GROUPS, OTHER_TOKEN_GROUP]
  return Object.keys(theme.tokens)
    .map((name) => ({ name, value: theme.tokens[name] ?? '', group: groupOfToken(name) }))
    .sort((left, right) => {
      const order = groups.indexOf(left.group) - groups.indexOf(right.group)
      return order !== 0 ? order : left.name.localeCompare(right.name)
    })
}

/** 写一个 token（值为空串表示删除）；返回新主题，不改原对象 */
export function setToken(theme: Theme, name: string, value: string): Theme {
  const tokens = { ...theme.tokens }
  if (value === '') delete tokens[name]
  else tokens[name] = value
  return { tokens }
}

export function removeToken(theme: Theme, name: string): Theme {
  return setToken(theme, name, '')
}
