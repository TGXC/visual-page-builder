/**
 * M7 文案候选（功能文档 AI4：选中文本块 → 3 个候选 → 应用其一 → 可撤销）。
 *
 * 规则式生成放在这里（不是 mock.ts 里），因为它是**离线路径**：
 * 供应商不可用 / 断网时，store 可以直接调它兜底，不依赖任何网络。
 */
import type { NodeId, Page, Patch } from '../core/schema/types'

export type TextTone = 'plain' | 'warm' | 'bold'

export interface TextCandidate {
  id: string
  text: string
  tone: TextTone
}

export interface TextOptions {
  tone?: TextTone
  maxLength?: number
}

export const TONES: readonly TextTone[] = ['plain', 'warm', 'bold']
export const MAX_TEXT_LENGTH = 80
export const DEFAULT_TEXT_LENGTH = 24
const FALLBACK = '全新上线'

export function truncateText(text: string, max: number): string {
  const limit = Math.max(1, Math.floor(max))
  return text.length <= limit ? text : text.slice(0, limit)
}

function variant(base: string, tone: TextTone): string {
  if (tone === 'warm') return `欢迎体验：${base}`
  if (tone === 'bold') return `${base}！`
  return base
}

/** 同一个提示词永远给同样 3 个候选（Mock 也要可测） */
export function textCandidates(prompt: string, options: TextOptions = {}): TextCandidate[] {
  const max = Math.min(options.maxLength ?? DEFAULT_TEXT_LENGTH, MAX_TEXT_LENGTH)
  const base = truncateText(prompt.trim().replace(/\s+/g, ' ') || FALLBACK, max)
  const order = options.tone ? [options.tone, ...TONES.filter((tone) => tone !== options.tone)] : [...TONES]
  return order.map((tone) => ({ id: `text-${tone}`, text: truncateText(variant(base, tone), max), tone }))
}

/** 供应商返回的候选：形状不对就返回 undefined，交给上层报 shape 错误 */
export function candidatesFromJson(raw: unknown): TextCandidate[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const list = (raw as { candidates?: unknown }).candidates
  if (!Array.isArray(list)) return undefined
  const candidates: TextCandidate[] = []
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const text = (item as { text?: unknown }).text
    if (typeof text !== 'string' || text.trim() === '') return
    const tone = (item as { tone?: unknown }).tone
    candidates.push({
      id: typeof (item as { id?: unknown }).id === 'string' ? String((item as { id: unknown }).id) : `cand-${index}`,
      text,
      tone: TONES.includes(tone as TextTone) ? (tone as TextTone) : 'plain',
    })
  })
  return candidates.length > 0 ? candidates : undefined
}

/** 只改 props.text：`before` 从当前节点现取，撤销靠它 */
export function textPatch(page: Page, nodeId: NodeId, text: string): Patch | null {
  const node = page.nodes[nodeId]
  if (!node) return null
  return {
    op: 'update',
    pageId: page.id,
    id: nodeId,
    before: { props: { ...node.props } },
    after: { props: { ...node.props, text } },
  }
}
