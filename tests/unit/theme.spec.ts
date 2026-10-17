import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_TOKENS } from '@/core/schema/catalog'
import { generateHtml, generatePageCss, inlineStyle } from '@/core/codegen'
import {
  cssVarOf,
  groupOfToken,
  isTokenRef,
  missingTokenRefs,
  pageUsesTokens,
  resolveStyle,
  resolveTokenValue,
  setToken,
  themeTokenEntries,
  themeVariablesCss,
  tokenLabel,
  tokenNameOf,
  tokenRef,
} from '@/core/theme'
import { makeDoc, makeNode, makePage } from './factories'

const theme = { tokens: { ...DEFAULT_THEME_TOKENS } }

function docWithRef() {
  const page = makePage({
    id: 'page_1',
    nodes: {
      root: makeNode({ id: 'root', type: 'frame' }),
      a: makeNode({
        id: 'a',
        parentId: 'root',
        style: { ...makeNode({ id: 'x' }).style, bg: '$color-primary', color: '$color-text', radius: 8 },
      }),
    },
  })
  return makeDoc({ pages: [page], activePageId: 'page_1' })
}

describe('M8 主题 token（core/theme，纯逻辑）', () => {
  it('识别 token 引用：只有 $ 开头 + 合法名字才算', () => {
    expect(isTokenRef('$color-primary')).toBe(true)
    expect(isTokenRef('$space-md')).toBe(true)
    expect(isTokenRef('$')).toBe(false)
    expect(isTokenRef('$not a name')).toBe(false)
    expect(isTokenRef('#FFFFFF')).toBe(false)
    expect(isTokenRef(12)).toBe(false)
    expect(tokenNameOf('$color-primary')).toBe('color-primary')
    expect(tokenRef('color-primary')).toBe('$color-primary')
  })

  it('按前缀把 token 归组（颜色 / 字号 / 间距 / 圆角 / 阴影，其余进「其他」）', () => {
    expect(groupOfToken('color-primary').id).toBe('color')
    expect(groupOfToken('font-size-lg').id).toBe('font-size')
    expect(groupOfToken('space-md').id).toBe('space')
    expect(groupOfToken('radius-lg').id).toBe('radius')
    expect(groupOfToken('shadow-lg').id).toBe('shadow')
    expect(groupOfToken('brand-weird').id).toBe('other')
  })

  it('解析引用：已知 token 取值，未知 token 回落给定兜底值', () => {
    expect(resolveTokenValue('$color-primary', theme)).toBe('#3B82F6')
    expect(resolveTokenValue('$nope', theme, '#000000')).toBe('#000000')
    expect(resolveTokenValue('#111111', theme)).toBe('#111111')
    expect(cssVarOf('color-primary')).toBe('var(--color-primary)')
  })

  it('resolveStyle() 把画布要的样式全部解析成具体值，未知引用留空', () => {
    const style = { ...makeNode({ id: 'x' }).style, bg: '$color-primary', color: '$nope' }
    const resolved = resolveStyle(style, theme)
    expect(resolved.bg).toBe('#3B82F6')
    expect(resolved.color).toBe('')
    expect(resolved.radius).toBe(style.radius)
  })

  it('missingTokenRefs() 报出引用了但主题里没有的 token（去重、排序）', () => {
    const page = makePage({
      id: 'page_1',
      nodes: {
        root: makeNode({ id: 'root', type: 'frame' }),
        a: makeNode({ id: 'a', parentId: 'root', style: { ...makeNode({ id: 'x' }).style, bg: '$ghost', color: '$ghost' } }),
        b: makeNode({ id: 'b', parentId: 'root', style: { ...makeNode({ id: 'x' }).style, bg: '$also-missing' } }),
      },
    })
    expect(missingTokenRefs(page, theme)).toEqual(['$also-missing', '$ghost'])
    expect(missingTokenRefs(makePage({ id: 'page_2' }), theme)).toEqual([])
  })

  it('主题面板数据：按组排序，setToken / 空值删除', () => {
    const entries = themeTokenEntries(theme)
    expect(entries[0]!.group.id).toBe('color')
    expect(entries.some((item) => item.name === 'space-md' && item.value === '16')).toBe(true)

    const next = setToken(theme, 'color-primary', '#E5484D')
    expect(next.tokens['color-primary']).toBe('#E5484D')
    expect(theme.tokens['color-primary']).toBe('#3B82F6') // 不改原对象
    expect(setToken(theme, 'color-primary', '').tokens['color-primary']).toBeUndefined()
    expect(setToken(theme, 'brand-new', '42').tokens['brand-new']).toBe('42')
  })

  it('CSS 变量块：空主题给空串，否则给出 :root 变量', () => {
    expect(themeVariablesCss({ tokens: {} })).toBe('')
    expect(themeVariablesCss({ tokens: { 'color-primary': '#3B82F6' } })).toBe(
      ':root{--color-primary:#3B82F6}',
    )
  })

  it('页面只在真的引用了 token 时才算「用到」（导出才不会平白多出 :root）', () => {
    expect(pageUsesTokens(docWithRef().pages[0]!)).toBe(true)
    expect(pageUsesTokens(makePage({ id: 'page_plain' }))).toBe(false)
  })

  it('导出：页面 CSS 带上 :root 变量 + var() 引用；画布内联样式是解析后的具体值', () => {
    const doc = docWithRef()
    const css = generatePageCss(doc, 'page_1')
    expect(css).toContain(':root{')
    expect(css).toContain('--color-primary:#3B82F6')
    expect(css).toContain('background:var(--color-primary)')
    expect(css).toContain('color:var(--color-text)')
    expect(generateHtml(doc, 'page_1')).toContain('var(--color-primary)')

    // 画布走解析后的具体值，DOM 里不该出现 var()
    const node = doc.pages[0]!.nodes['a']!
    const inline = inlineStyle(node, '', undefined, doc.theme.tokens)
    expect(inline).toContain('background:#3B82F6')
    expect(inline).not.toContain('var(')
  })

  it('没引用 token 的文档，导出结果里不出现 :root（保持既有快照稳定）', () => {
    const doc = makeDoc()
    expect(generatePageCss(doc, doc.activePageId)).not.toContain(':root{')
  })

  it('tokenLabel：默认 token 都有人能看懂的中文名，认不出的后缀如实回落', () => {
    // 颜色组：常见后缀直接给语义名
    expect(tokenLabel('color-primary')).toBe('主色')
    expect(tokenLabel('color-text')).toBe('正文颜色')
    expect(tokenLabel('color-muted')).toBe('弱化文字')
    expect(tokenLabel('color-bg')).toBe('背景色')
    expect(tokenLabel('color-surface')).toBe('面板底色')
    // 尺寸组：小/中/大 + 组名词
    expect(tokenLabel('radius-sm')).toBe('小圆角')
    expect(tokenLabel('radius-md')).toBe('中圆角')
    expect(tokenLabel('space-lg')).toBe('大间距')
    expect(tokenLabel('font-size-xl')).toBe('特大字号')
    expect(tokenLabel('shadow-sm')).toBe('小阴影')
    // 认不出的不猜：组名·后缀；其它组只带原始名
    expect(tokenLabel('color-brand')).toBe('颜色·brand')
    expect(tokenLabel('radius-huge')).toBe('圆角·huge')
    expect(tokenLabel('color')).toBe('颜色')
    expect(tokenLabel('brand')).toBe('其他·brand')
    // 默认主题的每个 token 都能翻译，面板上不会漏英文
    for (const name of Object.keys(DEFAULT_THEME_TOKENS)) {
      expect(tokenLabel(name)).not.toContain(name)
    }
  })
})
