import { describe, expect, it } from 'vitest'
import { drawPage, type Canvas2DLike } from '@/core/export'
import { makeDoc, makeNode, makeNodes, makePage } from './factories'

interface FakeCanvas {
  ctx: Canvas2DLike
  calls: string[]
  fillStyles: string[]
  lineWidths: number[]
  fonts: string[]
}

function fakeCanvas(): FakeCanvas {
  const calls: string[] = []
  const fillStyles: string[] = []
  const lineWidths: number[] = []
  const fonts: string[] = []
  const ctx: Canvas2DLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
    fillRect(x, y, w, h) {
      calls.push(`fillRect:${x},${y},${w},${h}`)
      fillStyles.push(ctx.fillStyle)
    },
    fillText(text, x, y) {
      calls.push(`fillText:${text},${x},${y}`)
      fillStyles.push(ctx.fillStyle)
      fonts.push(ctx.font)
    },
    strokeRect(x, y, w, h) {
      calls.push(`strokeRect:${x},${y},${w},${h}`)
      lineWidths.push(ctx.lineWidth)
    },
  }
  return { ctx, calls, fillStyles, lineWidths, fonts }
}

const pageKey = 'page_1'

describe('PNG 近似截图：drawPage', () => {
  it('找不到页面返回 false（pageKey 与 activePageId 都不匹配）', () => {
    const { ctx, calls } = fakeCanvas()
    const doc = makeDoc({ pages: [makePage({ id: pageKey })], activePageId: 'ghost' })
    expect(drawPage(ctx, doc, 'nope')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('先铺整页背景，默认白色', () => {
    const { ctx, calls, fillStyles } = fakeCanvas()
    const doc = makeDoc({ pages: [makePage({ id: pageKey })] })
    expect(drawPage(ctx, doc, pageKey)).toBe(true)
    expect(calls[0]).toBe('fillRect:0,0,1440,900')
    expect(fillStyles[0]).toBe('#ffffff')
  })

  it('可自定义背景色与字体族', () => {
    const { ctx, calls, fonts } = fakeCanvas()
    const node = makeNode({ id: 'n1', type: 'text', parentId: 'root', order: 0, props: { text: '标题' } })
    const doc = makeDoc({ pages: [makePage({ id: pageKey, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), node]) })] })
    drawPage(ctx, doc, pageKey, { background: '#101010', fontFamily: 'Inter' })
    expect(calls[0]).toBe('fillRect:0,0,1440,900')
    expect(fonts.some((font) => font.includes('Inter'))).toBe(true)
  })

  it('画背景矩形与边框（有边框色才描边）', () => {
    const { ctx, calls, lineWidths } = fakeCanvas()
    const boxed = makeNode({
      id: 'n1',
      parentId: 'root',
      order: 0,
      style: { ...makeNode({ id: 'x' }).style, bg: '#ff0000', borderWidth: 3, borderColor: '#000000' },
    })
    const plain = makeNode({
      id: 'n2',
      parentId: 'root',
      order: 1,
      style: { ...makeNode({ id: 'y' }).style, bg: '#00ff00', borderWidth: 2, borderColor: '' },
    })
    const doc = makeDoc({
      pages: [makePage({ id: pageKey, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), boxed, plain]) })],
    })
    drawPage(ctx, doc, pageKey)
    expect(calls).toContain('fillRect:0,0,160,100')
    expect(calls).toContain('strokeRect:0,0,160,100')
    // 只有「有边框色」的那个节点描边
    expect(calls.filter((call) => call.startsWith('strokeRect'))).toHaveLength(1)
    expect(lineWidths).toEqual([3])
  })

  it('非 fixed 尺寸按 0 画，隐藏节点整棵子树都跳过', () => {
    const { ctx, calls } = fakeCanvas()
    const auto = makeNode({
      id: 'n1',
      parentId: 'root',
      order: 0,
      style: { ...makeNode({ id: 'x' }).style, bg: '#ff0000' },
      layout: { ...makeNode({ id: 'y' }).layout, size: { w: { kind: 'hug' }, h: { kind: 'fill' } } },
    })
    const hidden = makeNode({ id: 'n2', parentId: 'root', order: 1, meta: { hidden: true, locked: false } })
    const child = makeNode({ id: 'n3', parentId: 'n2', order: 0, style: { ...makeNode({ id: 'z' }).style, bg: '#0000ff' } })
    const doc = makeDoc({ pages: [makePage({ id: pageKey, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), auto, hidden, child]) })] })
    drawPage(ctx, doc, pageKey)
    // 只有那个非 fixed 尺寸的可见节点被画成 0×0；隐藏节点与它的子树都没画
    expect(calls).toContain('fillRect:0,0,0,0')
    expect(calls).not.toContain('fillRect:0,0,160,100')
  })

  it('文字按 props.text → placeholder → 图层名 回退，非字符串忽略', () => {
    const { ctx, calls } = fakeCanvas()
    const withText = makeNode({ id: 'n1', type: 'text', parentId: 'root', order: 0, props: { text: '标题' } })
    const withPlaceholder = makeNode({ id: 'n2', type: 'input', parentId: 'root', order: 1, props: { placeholder: '请输入' } })
    const withName = makeNode({ id: 'n3', type: 'button', parentId: 'root', order: 2, meta: { name: '主按钮', hidden: false, locked: false } })
    const weird = makeNode({ id: 'n4', type: 'text', parentId: 'root', order: 3, props: { text: 42 } })
    const doc = makeDoc({
      pages: [makePage({ id: pageKey, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), withText, withPlaceholder, withName, weird]) })],
    })
    drawPage(ctx, doc, pageKey)
    const texts = calls.filter((call) => call.startsWith('fillText')).map((call) => call.split(':')[1].split(',')[0])
    expect(texts).toEqual(['标题', '请输入', '主按钮'])
  })

  it('frame/group 不写文字，但子节点照样递归', () => {
    const { ctx, calls } = fakeCanvas()
    const group = makeNode({ id: 'g1', type: 'group', parentId: 'root', order: 0, props: { text: '分组标题' } })
    const child = makeNode({ id: 'n1', type: 'text', parentId: 'g1', order: 0, props: { text: '组内文字' } })
    const doc = makeDoc({ pages: [makePage({ id: pageKey, nodes: makeNodes([makeNode({ id: 'root', type: 'frame' }), group, child]) })] })
    drawPage(ctx, doc, pageKey)
    const texts = calls.filter((call) => call.startsWith('fillText')).map((call) => call.split(':')[1].split(',')[0])
    expect(texts).toEqual(['组内文字'])
  })

  it('页面 key 也可以传根节点 id', () => {
    const { ctx, calls } = fakeCanvas()
    const doc = makeDoc({ pages: [makePage({ id: pageKey, root: 'root' })] })
    expect(drawPage(ctx, doc, 'root')).toBe(true)
    expect(calls[0]).toBe('fillRect:0,0,1440,900')
  })
})
