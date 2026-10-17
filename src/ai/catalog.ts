/**
 * 提示词素材（M6）：组件目录、页面大纲、JSON Schema。
 *
 * 组件目录直接来自描述符注册表（`aiDoc`），所以第三方注册的组件也会自动出现在
 * AI 的可用清单里 —— 不需要在 AI 模块里维护第二份组件表。
 */
import type { Doc, NodeId, PageId, SceneNode } from '../core/schema/types'
import { getComponent, listComponents } from '../core/components'
import { childrenOf } from '../core/tree'
import type { AiRequest } from './types'

export function componentCatalogText(): string {
  return listComponents()
    .map((descriptor) => {
      const props = Object.keys(descriptor.defaultProps)
      return `- ${descriptor.type}（${descriptor.label}，${descriptor.category}）${descriptor.container ? '容器' : ''}：${descriptor.aiDoc} 默认 ${descriptor.defaultSize.w}×${descriptor.defaultSize.h}，属性 ${props.join('/') || '无'}`
    })
    .join('\n')
}

function findPage(doc: Doc, pageId?: PageId) {
  return doc.pages.find((page) => page.id === pageId) ?? doc.pages.find((page) => page.id === doc.activePageId) ?? doc.pages[0]
}

function describe(node: SceneNode): string {
  const text = typeof node.props.text === 'string' && node.props.text !== '' ? `「${node.props.text}」` : ''
  return `${node.type}${text ? ` ${text}` : ''}`
}

/** 页面大纲：缩进树 + id，让 AI 知道有哪些节点可以改 */
export function docOutlineText(doc: Doc, pageId?: PageId, maxNodes = 60): string {
  const page = findPage(doc, pageId)
  if (!page) return '（没有页面）'
  const lines: string[] = [`页面 ${page.name}（id=${page.id}，画布 ${page.viewport.w}×${page.viewport.h}）`]
  const rootNode = page.nodes[page.root]
  if (rootNode) lines.push(`- ${describe(rootNode)} (id=${rootNode.id})`)
  let count = 0
  const walk = (parentId: NodeId, depth: number): void => {
    for (const node of childrenOf(page.nodes, parentId)) {
      if (count >= maxNodes) return
      count += 1
      lines.push(`${'  '.repeat(depth)}- ${describe(node)} (id=${node.id})`)
      walk(node.id, depth + 1)
    }
  }
  walk(page.root, 1)
  return lines.join('\n')
}

/** 生成页面的 JSON Schema（给真实供应商约束输出） */
export function draftJsonSchema(): Record<string, unknown> {
  const types = listComponents().map((descriptor) => descriptor.type)
  return {
    type: 'object',
    required: ['name', 'root', 'nodes'],
    properties: {
      name: { type: 'string' },
      path: { type: 'string' },
      root: { type: 'string' },
      nodes: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['type', 'parentId', 'order'],
          properties: {
            type: { type: 'string', enum: types },
            parentId: { type: ['string', 'null'] },
            order: { type: 'number' },
            name: { type: 'string' },
            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
            size: {
              type: 'object',
              properties: {
                w: { type: 'object', properties: { kind: { type: 'string', enum: ['fixed', 'hug', 'fill', 'ratio'] }, value: { type: 'number' } } },
                h: { type: 'object', properties: { kind: { type: 'string', enum: ['fixed', 'hug', 'fill', 'ratio'] }, value: { type: 'number' } } },
              },
            },
            style: { type: 'object' },
            props: { type: 'object' },
          },
        },
      },
    },
  }
}

/** 选区指令的 JSON Schema：只允许对给定 id 做 insert / remove / update / move */
export function instructionJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['patches'],
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['op'],
          properties: {
            op: { type: 'string', enum: ['insert', 'remove', 'update', 'move'] },
            id: { type: 'string' },
            parentId: { type: 'string' },
            order: { type: 'number' },
            type: { type: 'string' },
            style: { type: 'object' },
            props: { type: 'object' },
            layout: { type: 'object' },
            to: { type: 'object', properties: { parentId: { type: 'string' }, order: { type: 'number' } } },
          },
        },
      },
    },
  }
}

/** 把结构化请求拼成给真实供应商的消息（Mock 不走这条路） */
export function buildMessages(request: AiRequest): { role: 'system' | 'user'; content: string }[] {
  const system = [
    '你是可视化页面搭建器的助手。',
    '只输出 JSON，不要解释，不要 Markdown 代码块。',
    '文档结构：{ version:2, name, pages:[{ id, name, path, root, viewport:{w,h}, nodes:{ id: 节点 } }] }。',
    '节点形如 { id, type, parentId, order, layout:{ position:{x,y}, size:{w:{kind,value},h:{kind,value}} }, style, props, meta }。',
    '可用组件目录：',
    componentCatalogText(),
  ].join('\n')
  const parts: string[] = []
  if (request.context) {
    parts.push(`当前页面大纲：\n${docOutlineText(request.context.doc, request.context.pageId)}`)
    if (request.context.selectionIds && request.context.selectionIds.length > 0) {
      parts.push(`选区（只能改这些 id 及其子孙）：${request.context.selectionIds.join(', ')}`)
    }
  }
  parts.push(`用户要求：${request.prompt}`)
  parts.push(
    request.kind === 'page'
      ? `请输出页面草稿 JSON（Schema：${JSON.stringify(draftJsonSchema())}）`
      : request.kind === 'text'
        ? '请输出文案候选 JSON：{"candidates":[{"text":"...","tone":"plain|warm|bold"}]}，给 3 条互相不同的短文案。'
        : request.kind === 'plain'
          ? '请输出纯文本 JSON：{"text":"..."}，只给一条可以直接落库的短文案。'
          : request.kind === 'material'
          ? '请输出素材候选 JSON：{"candidates":[{"dataUrl":"data:image/png;base64,...","width":320,"height":200,"label":"..."}]}，只允许光栅图 dataURL。'
          : request.kind === 'component'
            ? `请输出自定义组件 JSON：{"dsl":${JSON.stringify(componentDslSchemaHint())}}（受限 DSL：只能组合组件目录里的类型 + 白名单样式键，不能写 JS/任意 CSS）`
            : `请输出补丁 JSON（Schema：${JSON.stringify(instructionJsonSchema())}）`,
  )
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ]
}

/** 受限 DSL 的形状提示（真实供应商用；本地仍会过 `validateDsl` 白名单） */
export function componentDslSchemaHint(): Record<string, unknown> {
  return {
    name: '组件名（≤24 字）',
    icon: '可选',
    size: { w: 280, h: 140 },
    props: [{ key: 'title', label: '标题', type: 'text', default: '默认文案' }],
    root: { type: 'card', style: { bg: '#FFFFFF' }, children: [{ type: 'text', text: '{{title}}' }] },
  }
}

/** 描述某个节点「能不能放子节点」，Mock 生成时用 */
export function canContain(type: string): boolean {
  return getComponent(type)?.container === true
}
