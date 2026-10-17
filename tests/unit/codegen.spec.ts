import { describe, expect, it } from 'vitest'
import type { Doc, SceneNode } from '@/core/schema/types'
import {
  escapeHtml,
  generateBodyHtml,
  generateCss,
  generateHtml,
  inlineStyle,
  safeUrl,
} from '@/core/codegen'
import { docWithNodes, makeNode } from './factories'

function doc(nodes: SceneNode[]): Doc {
  return docWithNodes(nodes)
}

function html(doc: Doc, _id: string): string {
  return generateBodyHtml(doc, doc.activePageId)
}

describe('codegen：转义与 URL 安全', () => {
  it('escapeHtml 处理 & < > " 四个字符', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('safeUrl 只放行 http/https/相对路径/锚点，拦掉 javascript:', () => {
    expect(safeUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(safeUrl('/assets/a.png')).toBe('/assets/a.png')
    expect(safeUrl('#top')).toBe('#top')
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('  JavaScript:alert(1)')).toBe('')
    expect(safeUrl('data:text/html,<script>')).toBe('')
  })

  it('safeUrl 放行光栅图 dataURL（本地文件通道要用），仍拦掉可执行类型', () => {
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(safeUrl('DATA:image/jpeg;base64,/9j/4AAQ')).toBe('DATA:image/jpeg;base64,/9j/4AAQ')
    expect(safeUrl('data:image/webp;base64,UklGRg==')).toBe('data:image/webp;base64,UklGRg==')
    // SVG 能内嵌脚本，图片上下文里不执行，但导出文件可能被别的工具当文档打开，宁可不放行
    expect(safeUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe('')
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('')
  })
})

describe('codegen：inlineStyle', () => {
  it('自由布局输出绝对定位与像素尺寸', () => {
    const node = makeNode({
      id: 'a',
      layout: {
        ...makeNode({ id: 'x' }).layout,
        position: { x: 30, y: 40 },
        size: { w: { kind: 'fixed', value: 200 }, h: { kind: 'fixed', value: 50 } },
      },
    })
    const css = inlineStyle(node)
    expect(css).toContain('position:absolute')
    expect(css).toContain('left:30px')
    expect(css).toContain('top:40px')
    expect(css).toContain('width:200px')
    expect(css).toContain('height:50px')
  })

  it('未设置的样式不输出（\'\' 与 0 表示未设置）', () => {
    const css = inlineStyle(makeNode({ id: 'a' }))
    expect(css).not.toContain('background')
    expect(css).not.toContain('font-size')
    expect(css).not.toContain('border-radius')
    expect(css).not.toContain('box-shadow')
  })

  it('已设置的样式全部落到 CSS 文本', () => {
    const base = makeNode({ id: 'a' }).layout
    const node = makeNode({
      id: 'a',
      layout: base,
      style: {
        bg: '#fff',
        color: '#111',
        fontSize: 16,
        fontWeight: 700,
        align: 'center',
        radius: 8,
        borderWidth: 2,
        borderColor: '#000',
        opacity: 0.5,
        shadowBlur: 4,
        shadowX: 1,
        shadowY: 2,
        shadowColor: '#999',
        lineHeight: 1.5,
        letterSpacing: 0.5,
      },
    })
    const css = inlineStyle(node)
    expect(css).toContain('background:#fff')
    expect(css).toContain('color:#111')
    expect(css).toContain('font-size:16px')
    expect(css).toContain('font-weight:700')
    expect(css).toContain('text-align:center')
    expect(css).toContain('border-radius:8px')
    expect(css).toContain('border:2px solid #000')
    expect(css).toContain('opacity:0.5')
    expect(css).toContain('box-shadow:1px 2px 4px #999')
    expect(css).toContain('line-height:1.5')
    expect(css).toContain('letter-spacing:0.5px')
  })

  it('hidden 的节点导出为 display:none', () => {
    const node = makeNode({ id: 'a', meta: { hidden: true, locked: false } })
    expect(inlineStyle(node)).toContain('display:none')
  })
})

describe('codegen：各类组件的 HTML', () => {
  it('text 输出转义后的文案', () => {
    const output = html(doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 't', parentId: 'root', type: 'text', props: { text: '<b>hi</b>' } })]), 'root')
    expect(output).toContain('&lt;b&gt;hi&lt;/b&gt;')
  })

  it('button/input/textarea/select 输出对应标签与占位', () => {
    const output = html(
      doc([
        makeNode({ id: 'root', type: 'frame' }),
        makeNode({ id: 'b', parentId: 'root', type: 'button', props: { text: '提交' } }),
        makeNode({ id: 'i', parentId: 'root', type: 'input', props: { placeholder: '姓名' } }),
        makeNode({ id: 'ta', parentId: 'root', type: 'textarea', props: { placeholder: '留言' } }),
        makeNode({ id: 's', parentId: 'root', type: 'select', props: { text: '甲,乙', placeholder: '请选择' } }),
      ]),
      'root',
    )
    expect(output).toContain('<button')
    expect(output).toContain('提交')
    expect(output).toContain('placeholder="姓名"')
    expect(output).toContain('<textarea')
    expect(output).toContain('<select')
    expect(output).toContain('<option>甲</option>')
  })

  it('image 有 src 时用背景图，没有时保留占位文案', () => {
    const withSrcDoc = doc([
      makeNode({ id: 'root', type: 'frame' }),
      makeNode({ id: 'img', parentId: 'root', type: 'image', props: { src: 'https://x/a.png' } }),
    ])
    // M5 起背景图落进 `.n-img` 的 CSS 规则，而不是元素的内联样式
    expect(generateCss(withSrcDoc, withSrcDoc.activePageId)).toContain('background-image:url(https://x/a.png)')
    expect(html(withSrcDoc, 'root')).not.toContain('style="')

    const noSrc = html(doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'img', parentId: 'root', type: 'image', props: { text: '🖼️' } })]), 'root')
    expect(noSrc).toContain('🖼️')
  })

  it('video 输出 video 标签并拦掉危险 URL', () => {
    const ok = html(doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'v', parentId: 'root', type: 'video', props: { src: 'https://x/a.mp4' } })]), 'root')
    expect(ok).toContain('<video src="https://x/a.mp4"')

    const bad = html(doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'v', parentId: 'root', type: 'video', props: { src: 'javascript:alert(1)' } })]), 'root')
    expect(bad).not.toContain('javascript:')
  })

  it('带 link 的节点用 <a target="_blank" rel="noopener"> 包裹', () => {
    const output = html(
      doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 't', parentId: 'root', type: 'text', props: { text: '去', link: 'https://x' } })]),
      'root',
    )
    expect(output).toContain('<a href="https://x" target="_blank" rel="noopener">')
  })

  it('容器节点（frame/group）递归渲染子节点，且子节点在父节点内部', () => {
    const output = html(
      doc([
        makeNode({ id: 'root', type: 'frame' }),
        makeNode({ id: 'box', parentId: 'root', type: 'group' }),
        makeNode({ id: 'inner', parentId: 'box', type: 'text', props: { text: '深层' } }),
      ]),
      'root',
    )
    expect(output.indexOf('data-id="box"')).toBeLessThan(output.indexOf('data-id="inner"'))
  })

  it('每个元素带 data-id，便于导出后与画布对齐排查', () => {
    const output = html(doc([makeNode({ id: 'root', type: 'frame' }), makeNode({ id: 'a', parentId: 'root' })]), 'root')
    expect(output).toContain('data-id="root"')
    expect(output).toContain('data-id="a"')
  })
})

describe('codegen：整页文档', () => {
  it('generateHtml 输出完整文档（doctype/charset/title/body）', () => {
    const document_ = doc([makeNode({ id: 'root', type: 'frame' })])
    const page = generateHtml(document_, 'root')
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(page).toContain('<meta charset="utf-8">')
    expect(page).toContain('<title>测试项目</title>')
    expect(page).toContain('<body>')
    expect(page).toContain('data-page="page_1"')
  })

  it('generateHtml 用页面 viewport 作为画布尺寸', () => {
    const document_ = doc([makeNode({ id: 'root', type: 'frame' })])
    const page = generateHtml(document_, 'root')
    expect(page).toContain('width:1440px')
    expect(page).toContain('height:900px')
  })

  it('generateCss 在 M1 只给出内联样式的说明注释', () => {
    expect(generateCss(doc([makeNode({ id: 'root', type: 'frame' })])).length).toBeGreaterThan(0)
  })
})
