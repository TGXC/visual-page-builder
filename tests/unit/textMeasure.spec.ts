import { describe, expect, it } from 'vitest'
import { createTextMeasurer, FONT_STACK } from '@/utils/textMeasure'
import { makeNode } from './factories'

/**
 * M2：`hug` 文本测量。
 *
 * 测量要用真实字体度量，所以核心是「注入一个 2D 上下文」的可测函数；
 * 拿不到上下文（jsdom、无 DOM 环境）必须返回 undefined，让布局引擎退回字符估算并标记 estimated。
 */

/** 假上下文：按 1 字符 10px 算，方便手算折行 */
function fakeContext(charWidth = 10): { font: string; measureText(text: string): { width: number } } {
  return {
    font: '',
    measureText: (text: string) => ({ width: [...text].length * charWidth }),
  }
}

describe('M2 文本测量：折行与回退', () => {
  it('按可用宽度折行，行高取 style.lineHeight，字体按字号生成', () => {
    const ctx = fakeContext(10)
    const measure = createTextMeasurer(ctx)
    const node = makeNode({ id: 't', type: 'text', props: { text: 'abcd' } })
    node.style = { ...node.style, fontSize: 20, lineHeight: 30 }

    // 可用宽 25 → 每行 2 个字符
    expect(measure(node, { w: 25 })).toEqual({ w: 20, h: 60 })
    expect(ctx.font).toBe(`400 20px ${FONT_STACK}`)
  })

  it('没设 lineHeight 时按字号 1.4 倍估行高，\\n 强制换行', () => {
    const measure = createTextMeasurer(fakeContext(10))
    const node = makeNode({ id: 't', type: 'text', props: { text: 'a\nb' } })
    node.style = { ...node.style, fontSize: 10 }

    expect(measure(node, { w: 100 })).toEqual({ w: 10, h: 28 })
  })

  it('可用宽度为 0 时夹到 1px（每个字符独占一行），不会除零或死循环', () => {
    const measure = createTextMeasurer(fakeContext(10))
    const node = makeNode({ id: 't', type: 'text', props: { text: 'abc' } })
    node.style = { ...node.style, fontSize: 10, lineHeight: 10 }

    expect(measure(node, { w: 0 })).toEqual({ w: 10, h: 30 })
  })

  it('空文本或拿不到上下文时返回 undefined（交给布局引擎估算）', () => {
    const measure = createTextMeasurer(fakeContext())
    expect(measure(makeNode({ id: 't', type: 'text', props: { text: '   ' } }), { w: 100 })).toBeUndefined()

    const headless = createTextMeasurer(null)
    expect(headless(makeNode({ id: 't', type: 'text', props: { text: 'abc' } }), { w: 100 })).toBeUndefined()
  })

  it('重复测量命中缓存（同一份文本不反复走 measureText）', () => {
    let calls = 0
    const ctx = {
      font: '',
      measureText: (text: string) => {
        calls += 1
        return { width: [...text].length * 10 }
      },
    }
    const measure = createTextMeasurer(ctx)
    const node = makeNode({ id: 't', type: 'text', props: { text: 'abcd' } })
    node.style = { ...node.style, fontSize: 12, lineHeight: 16 }

    measure(node, { w: 100 })
    const first = calls
    measure(node, { w: 100 })
    expect(calls).toBe(first)
  })
})
