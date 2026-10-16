/**
 * M2：`hug` 文本测量。
 *
 * 布局引擎是纯函数，不碰 DOM，所以「一个文本节点实际多宽多高」必须由外面注入
 * （`computeLayout({ measure })`）。这里做两件事：
 * 1. 用真实字体的 `measureText` 折行算尺寸（比按字符数估算准，中英文混排差很多）；
 * 2. 拿不到 2D 上下文时（jsdom、SSR、无 DOM）返回 `undefined`，
 *    布局引擎会退回 `estimateTextSize()` 并把节点记进 `estimated`，界面上可以提示「尺寸是估算的」。
 *
 * 注意：这是 `src/utils` 而不是 `src/core` —— 它碰了 `document`，layering 规则只允许 core 是纯逻辑。
 */
import type { SceneNode } from '@/core/schema/types'
import type { TextMeasure } from '@/core/layout'

/** 受控样式里没有字体族（STYLE_KEYS 15 项不含 fontFamily），这里固定一套栈 */
export const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif'

export interface TextContext {
  font: string
  measureText(text: string): { width: number }
}

const CACHE_LIMIT = 800
const cache = new Map<string, { w: number; h: number }>()

/**
 * 生成一个测量函数。`context` 传 null 表示环境不支持 → 恒返回 undefined（走估算）。
 * 注入上下文而不是内部 new，是为了让折行逻辑能在 jsdom 里用手算的假上下文测。
 */
export function createTextMeasurer(context: TextContext | null): TextMeasure {
  if (!context) return () => undefined
  const ctx = context

  return (node: SceneNode, available: { w: number }): { w: number; h: number } | undefined => {
    const text = typeof node.props.text === 'string' ? node.props.text : ''
    if (text.trim() === '') return undefined

    const fontSize = node.style.fontSize > 0 ? node.style.fontSize : 14
    const fontWeight = node.style.fontWeight > 0 ? node.style.fontWeight : 400
    const lineHeight = node.style.lineHeight > 0 ? node.style.lineHeight : Math.round(fontSize * 1.4)
    const font = `${fontWeight} ${fontSize}px ${FONT_STACK}`
    const maxWidth = Math.max(1, Math.round(available.w))
    const key = `${font}|${maxWidth}|${text}`

    const hit = cache.get(key)
    if (hit) return hit

    ctx.font = font
    let widest = 0
    let lines = 0
    for (const paragraph of text.split('\n')) {
      const chars = [...paragraph]
      if (chars.length === 0) {
        lines += 1
        continue
      }
      let line = ''
      for (const char of chars) {
        const next = line + char
        if (line !== '' && ctx.measureText(next).width > maxWidth) {
          widest = Math.max(widest, ctx.measureText(line).width)
          lines += 1
          line = char
        } else {
          line = next
        }
      }
      widest = Math.max(widest, ctx.measureText(line).width)
      lines += 1
    }

    const result = { w: Math.ceil(widest), h: lines * lineHeight }
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(key, result)
    return result
  }
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom|happy-dom/i.test(navigator.userAgent)
}

function realContext(): TextContext | null {
  if (typeof document === 'undefined' || isJsdom()) return null
  try {
    return document.createElement('canvas').getContext('2d') as TextContext | null
  } catch {
    return null
  }
}

/** 浏览器里可直接用的测量函数；每次调用都判断环境（拿不到就是 undefined，代价只有一次判断） */
export const measureText: TextMeasure = (node, available) => createTextMeasurer(realContext())(node, available)
