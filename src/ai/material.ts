/**
 * M7 素材候选（功能文档 AI4 素材 + AI6 安全）。
 *
 * Mock 路径**现场编码 PNG**（`core/png`，纯逻辑）而不是外链图片：
 * ①离线可用；②dataURL 能过 `safeUrl()` 的白名单（只放行光栅图）；③导出文件自带素材，不依赖网络。
 * 结果写进节点 `props.src`，并按功能文档要求带上来源标记 `props.source`。
 */
import { safeUrl } from '../core/html'
import type { Rgb } from '../core/png'
import { createPlaceholderPng, toBase64 } from '../core/png'
import type { NodeId, Page, Patch } from '../core/schema/types'

export type MaterialSource = 'generated' | 'library'

export interface MaterialCandidate {
  id: string
  label: string
  dataUrl: string
  source: MaterialSource
  width: number
  height: number
}

export interface MaterialSize {
  width: number
  height: number
}

const DEFAULT_SIZE: MaterialSize = { width: 320, height: 200 }

function hashOf(text: string): number {
  let hash = 2166136261
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

/** 提示词 → 一对渐变色：不同提示词给出不同配色，同提示词永远一致 */
function paletteOf(hash: number, index: number): { from: Rgb; to: Rgb } {
  const seed = (hash + index * 0x9e3779b9) >>> 0
  return {
    from: { r: clamp(60 + (seed % 150)), g: clamp(70 + ((seed >> 4) % 150)), b: clamp(90 + ((seed >> 8) % 150)) },
    to: { r: clamp(190 + ((seed >> 12) % 60)), g: clamp(200 + ((seed >> 16) % 55)), b: clamp(210 + ((seed >> 20) % 45)) },
  }
}

export function materialCandidates(prompt: string, size: MaterialSize = DEFAULT_SIZE): MaterialCandidate[] {
  const key = prompt.trim() || '占位素材'
  const hash = hashOf(key)
  return [0, 1, 2].map((index) => {
    const { from, to } = paletteOf(hash, index)
    const bytes = createPlaceholderPng(size.width, size.height, from, to)
    return {
      id: `material-${hash.toString(36)}-${index}`,
      label: `${key.slice(0, 12)} 占位图 ${index + 1}`,
      dataUrl: `data:image/png;base64,${toBase64(bytes)}`,
      source: 'generated' as const,
      width: size.width,
      height: size.height,
    }
  })
}

/** 只认白名单里的光栅图 dataURL（`safeUrl` 会拦掉 SVG 与脚本类 dataURL） */
export function isUsableMaterial(dataUrl: string): boolean {
  if (typeof dataUrl !== 'string' || dataUrl === '') return false
  if (!/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,/i.test(dataUrl)) return false
  return safeUrl(dataUrl) !== ''
}

/** 供应商返回的素材候选：逐个过 `isUsableMaterial`，一个都不合法就返回 undefined */
export function materialCandidatesFromJson(raw: unknown): MaterialCandidate[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const list = (raw as { candidates?: unknown }).candidates
  if (!Array.isArray(list)) return undefined
  const candidates: MaterialCandidate[] = []
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const dataUrl = (item as { dataUrl?: unknown }).dataUrl
    if (typeof dataUrl !== 'string' || !isUsableMaterial(dataUrl)) return
    const width = Number((item as { width?: unknown }).width)
    const height = Number((item as { height?: unknown }).height)
    candidates.push({
      id: typeof (item as { id?: unknown }).id === 'string' ? String((item as { id: unknown }).id) : `material-${index}`,
      label: typeof (item as { label?: unknown }).label === 'string' ? String((item as { label: unknown }).label) : `素材 ${index + 1}`,
      dataUrl,
      source: (item as { source?: unknown }).source === 'library' ? 'library' : 'generated',
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : 320,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : 200,
    })
  })
  return candidates.length > 0 ? candidates : undefined
}

/** 写 props.src + 来源标记，缺 alt 时补一个（顺带消掉 M6 的 missing-alt 问题） */
export function materialPatch(page: Page, nodeId: NodeId, candidate: MaterialCandidate, alt = ''): Patch | null {
  if (!isUsableMaterial(candidate.dataUrl)) return null
  const node = page.nodes[nodeId]
  if (!node) return null
  const existingAlt = typeof node.props.alt === 'string' ? node.props.alt : ''
  return {
    op: 'update',
    pageId: page.id,
    id: nodeId,
    before: { props: { ...node.props } },
    after: {
      props: {
        ...node.props,
        src: candidate.dataUrl,
        source: candidate.source,
        alt: existingAlt || alt || candidate.label,
      },
    },
  }
}
