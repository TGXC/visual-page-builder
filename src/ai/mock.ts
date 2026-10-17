/**
 * Mock provider（M6 / AI0 第 3 条：离线可用）。
 *
 * 不联网、不配 key 也能跑：按 prompt 里的关键词生成**确定性**的 PageDraft / Patch[]。
 * 它的输出和真实供应商走完全相同的三重校验，所以「Mock 能落库」就等于
 * 「真实供应商只要 JSON 合法也能落库」。
 */
import type { NodeId, Page, SceneNode } from '../core/schema/types'
import { hasComponent, isContainerType } from '../core/components'
import { childrenOf } from '../core/tree'
import type { AiProvider, AiRequest, AiResponse } from './types'

export interface MockProviderOptions {
  /** 改 id / label 可以在「模型选择」下拉里造多个假供应商 */
  id?: string
  label?: string
  /** 人为延迟，用来测 loading 态 */
  delayMs?: number
}

function pageOf(request: AiRequest) {
  const doc = request.context?.doc
  if (!doc) return undefined
  return doc.pages.find((page) => page.id === request.context?.pageId) ?? doc.pages[0]
}

function titleOf(prompt: string): string {
  const cleaned = prompt.replace(/[。！？!?，,、；;：:\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ').filter(Boolean)
  const title = words.slice(0, 2).join('') || 'AI 生成页面'
  return title.slice(0, 18)
}

function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

/** 抓「」或引号里的文案 */
function quotedText(prompt: string): string | null {
  const match = prompt.match(/[「“"']([^」”"']{1,40})[」”"']/)
  return match ? match[1].trim() : null
}

/** 生成一页草稿 JSON（形状由 `core/ai/draft.ts` 三重校验） */
export function mockDraft(request: AiRequest): unknown {
  const page = pageOf(request)
  const viewport = page ? { ...page.viewport } : { w: 1440, h: 900 }
  const name = titleOf(request.prompt)
  const keyword = request.prompt.trim().slice(0, 40)
  const make = (
    id: string,
    type: string,
    parentId: string | null,
    order: number,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({ id, type, parentId, order, ...extra })

  const fill = { w: { kind: 'fill' }, h: { kind: 'fixed', value: 48 } }
  return {
    name,
    path: `/${slugOf(name) || 'ai-page'}`,
    viewport,
    root: 'ai-root',
    nodes: {
      'ai-root': make('ai-root', 'frame', null, 0, {
        layout: { mode: 'vertical', size: { w: { kind: 'fixed', value: viewport.w }, h: { kind: 'fixed', value: viewport.h } }, gap: 0 },
      }),
      'ai-hero': make('ai-hero', 'section', 'ai-root', 0, {
        layout: {
          mode: 'vertical',
          size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 360 } },
          padding: { top: 48, right: 40, bottom: 40, left: 40 },
          gap: 16,
        },
        style: { bg: '#F5F7FA' },
      }),
      'ai-title': make('ai-title', 'heading', 'ai-hero', 0, {
        layout: { size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 48 } } },
        style: { fontSize: 36, fontWeight: 700, color: '#111827' },
        props: { text: name },
      }),
      'ai-sub': make('ai-sub', 'text', 'ai-hero', 1, {
        layout: { size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 28 } } },
        style: { fontSize: 16, color: '#4B5563' },
        props: { text: keyword },
      }),
      'ai-cta': make('ai-cta', 'button', 'ai-hero', 2, {
        layout: { size: { w: { kind: 'fixed', value: 160 }, h: { kind: 'fixed', value: 44 } } },
        style: { bg: '#2563EB', color: '#FFFFFF' },
        props: { text: '立即开始' },
      }),
      'ai-features': make('ai-features', 'section', 'ai-root', 1, {
        layout: {
          mode: 'vertical',
          size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 300 } },
          padding: { top: 32, right: 40, bottom: 32, left: 40 },
          gap: 12,
        },
      }),
      'ai-f1': make('ai-f1', 'card', 'ai-features', 0, {
        layout: { size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 72 } } },
        props: { text: '亮点一：可视化拖拽，改完即所见' },
      }),
      'ai-f2': make('ai-f2', 'card', 'ai-features', 1, {
        layout: { size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 72 } } },
        props: { text: '亮点二：导出语义化 HTML / CSS' },
      }),
      'ai-f3': make('ai-f3', 'card', 'ai-features', 2, {
        layout: { size: { w: { kind: 'fill' }, h: { kind: 'fixed', value: 72 } } },
        props: { text: '亮点三：断点覆盖，一套内容多端适配' },
      }),
      'ai-foot': make('ai-foot', 'text', 'ai-root', 2, {
        layout: { size: fill },
        props: { text: `© ${new Date().getFullYear()} Studio` },
      }),
    },
  }
}

function fullStyle(node: SceneNode, patch: Partial<SceneNode['style']>): SceneNode['style'] {
  return { ...node.style, ...patch }
}

function fullLayout(node: SceneNode, patch: Partial<SceneNode['layout']>): SceneNode['layout'] {
  return { ...node.layout, ...patch }
}

function scaled(node: SceneNode, factor: number): SceneNode['layout'] {
  const scaleSpec = (spec: SceneNode['layout']['size']['w']) =>
    spec.kind === 'fixed' ? { kind: 'fixed' as const, value: Math.round((spec.value ?? 0) * factor) } : { ...spec }
  return fullLayout(node, { size: { w: scaleSpec(node.layout.size.w), h: scaleSpec(node.layout.size.h) } })
}

/** 造一个插入用的新节点（未收敛，交给 normalizePage 补默认值） */
function draftNode(parentId: NodeId, order: number, type: string, text: string): Record<string, unknown> {
  return {
    id: `${parentId}~ai${order}`,
    type,
    parentId,
    order,
    layout: { size: { w: { kind: 'fixed', value: type === 'button' ? 140 : 240 }, h: { kind: 'fixed', value: 44 } } },
    style: type === 'button' ? { bg: '#2563EB', color: '#FFFFFF' } : {},
    props: { text },
  }
}

/** 组一条 update 补丁：`before` 从当前节点现取（撤销要靠它） */
function updatePatch(pageId: string, node: SceneNode, after: Record<string, unknown>): Record<string, unknown> {
  const before: Record<string, unknown> = {}
  if (after.layout) before.layout = node.layout
  if (after.style) before.style = node.style
  if (after.props) before.props = { ...node.props }
  return { op: 'update', pageId, id: node.id, before, after }
}

/** 广度优先找第一段带文案的后代：选中容器让 AI 改文案时，落在它身上 */
function firstTextDescendant(page: Page, rootId: NodeId): SceneNode | undefined {
  const queue = [...childrenOf(page.nodes, rootId)]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) break
    if (typeof node.props.text === 'string' && node.props.text !== '') return node
    queue.push(...childrenOf(page.nodes, node.id))
  }
  return undefined
}

/** 生成选区补丁 JSON（只针对选中的 id） */
export function mockInstruction(request: AiRequest): unknown {
  const page = pageOf(request)
  const selection = request.context?.selectionIds ?? []
  if (!page || selection.length === 0) return { patches: [] }
  const prompt = request.prompt
  const patches: Record<string, unknown>[] = []
  const quoted = quotedText(prompt)

  for (const id of selection) {
    const node = page.nodes[id]
    if (!node) continue
    if (/删除|移除|去掉|不要/.test(prompt)) {
      patches.push({ op: 'remove', pageId: page.id, node })
      continue
    }
    if (/加一个|插入|新增|再来一个|复制/.test(prompt) && isContainerType(node.type)) {
      const type = /按钮/.test(prompt) ? 'button' : /标题/.test(prompt) ? 'heading' : 'text'
      const order = childrenOf(page.nodes, node.id).length
      patches.push({
        op: 'insert',
        pageId: page.id,
        node: draftNode(node.id, order, type, quoted ?? '新增内容'),
      })
      continue
    }
    const after: Record<string, unknown> = {}
    if (/大一点|放大|变大/.test(prompt)) after.layout = scaled(node, 1.2)
    if (/小一点|缩小|变小/.test(prompt)) after.layout = scaled(node, 0.8)
    if (/红/.test(prompt)) after.style = fullStyle(node, { bg: '#E5484D' })
    if (/居中/.test(prompt)) after.style = fullStyle(node, { align: 'center' })
    if (/加大|更大/.test(prompt) && !after.style) after.style = fullStyle(node, { fontSize: (node.style.fontSize || 16) + 4 })

    // 「改成某文案」：选中的是文字节点就改它自己；选中的是容器就改它里面第一段有文案的后代
    if (quoted && !isContainerType(node.type)) after.props = { ...node.props, text: quoted }
    if (Object.keys(after).length === 0 && !quoted) after.props = { ...node.props, text: prompt.trim().slice(0, 60) }
    if (Object.keys(after).length > 0) patches.push(updatePatch(page.id, node, after))

    if (quoted && isContainerType(node.type)) {
      const target = firstTextDescendant(page, node.id)
      if (target) patches.push(updatePatch(page.id, target, { props: { ...target.props, text: quoted } }))
    }
  }
  return { patches }
}

export function createMockProvider(options: MockProviderOptions = {}): AiProvider {
  const id = options.id ?? 'mock'
  const provider = {
    id,
    label: options.label ?? '内置规则助手（离线）',
    ready: true,
    async complete(request: AiRequest): Promise<AiResponse> {
      const started = Date.now()
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.delayMs ?? 0, 2000)))
      }
      const ms = Date.now() - started
      if (request.kind === 'page') {
        return { ok: true, json: mockDraft(request), provider: id, ms }
      }
      if (request.kind === 'instruction') {
        if ((request.context?.selectionIds ?? []).length === 0) {
          return { ok: false, error: '请先选中要修改的元素', provider: id, ms }
        }
        return { ok: true, json: mockInstruction(request), provider: id, ms }
      }
      return { ok: true, text: titleOf(request.prompt), provider: id, ms }
    },
  }
  return provider
}

/** 校验一个 payload 里的节点类型是否都在白名单里（orchestrator 复用） */
export function unknownTypes(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const nodes = (raw as { nodes?: unknown }).nodes
  if (!nodes || typeof nodes !== 'object') return []
  const bad: string[] = []
  for (const value of Object.values(nodes as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const type = (value as { type?: unknown }).type
    if (typeof type === 'string' && !hasComponent(type)) bad.push(type)
  }
  return bad
}
