/**
 * PNG 截图：把一页画成位图。
 *
 * core 只依赖一个最小的 2D 上下文接口（不 import 任何 DOM 类型），
 * 因此在 jsdom 里可以用假上下文做单测；真实 canvas 由调用方提供。
 * 这是「近似截图」：矩形用 fillRect，文字用 fillText，不做字体测量与换行。
 */
import type { Doc, NodeId, SceneNode } from '@/core/schema/types'
import { childrenOf } from '@/core/tree'

export interface Canvas2DLike {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textBaseline: string
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
}

export interface DrawOptions {
  background?: string
  fontFamily?: string
}

function resolvePage(doc: Doc, pageKey: string): { root: NodeId; nodes: Record<NodeId, SceneNode> } | null {
  const page = doc.pages.find((item) => item.id === pageKey || item.root === pageKey) ?? doc.pages.find((item) => item.id === doc.activePageId)
  if (!page) return null
  return { root: page.root, nodes: page.nodes }
}

function textOf(node: SceneNode): string {
  const value = node.props.text ?? node.props.placeholder ?? node.meta.name
  return typeof value === 'string' ? value : ''
}

function drawNode(target: Canvas2DLike, nodes: Record<NodeId, SceneNode>, node: SceneNode, fontFamily: string): void {
  if (node.meta.hidden) return
  const { x, y } = node.layout.position
  const w = node.layout.size.w.kind === 'fixed' ? node.layout.size.w.value ?? 0 : 0
  const h = node.layout.size.h.kind === 'fixed' ? node.layout.size.h.value ?? 0 : 0
  if (node.style.bg) {
    target.fillStyle = node.style.bg
    target.fillRect(x, y, w, h)
  }
  if (node.style.borderWidth > 0 && node.style.borderColor) {
    target.strokeStyle = node.style.borderColor
    target.lineWidth = node.style.borderWidth
    target.strokeRect(x, y, w, h)
  }
  const text = textOf(node)
  if (text && node.type !== 'frame' && node.type !== 'group') {
    target.fillStyle = node.style.color || '#1e293b'
    const size = node.style.fontSize > 0 ? node.style.fontSize : 14
    target.font = `${node.style.fontWeight > 0 ? node.style.fontWeight : 400} ${size}px ${fontFamily}`
    target.textBaseline = 'top'
    // padding 在 layout 上（StyleSpec 没有这个字段），文字按内边距内缩，未设置时回落 8px
    const padLeft = node.layout.padding.left || 8
    const padTop = node.layout.padding.top || 8
    target.fillText(text, x + padLeft, y + padTop)
  }
  for (const child of childrenOf(nodes, node.id)) drawNode(target, nodes, child, fontFamily)
}

/** 把 `doc` 的某一页画到 `target` 上；找不到页面返回 false。 */
export function drawPage(target: Canvas2DLike, doc: Doc, pageKey: string, options: DrawOptions = {}): boolean {
  const resolved = resolvePage(doc, pageKey)
  if (!resolved) return false
  const page = doc.pages.find((item) => item.root === resolved.root)!
  target.fillStyle = options.background ?? '#ffffff'
  target.fillRect(0, 0, page.viewport.w, page.viewport.h)
  const root = resolved.nodes[resolved.root]
  const fontFamily = options.fontFamily ?? 'system-ui, sans-serif'
  if (root) for (const child of childrenOf(resolved.nodes, root.id)) drawNode(target, resolved.nodes, child, fontFamily)
  return true
}
