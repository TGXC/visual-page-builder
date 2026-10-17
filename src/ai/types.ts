/**
 * AI 供应商抽象（M6 / 功能文档 AI6）。
 *
 * 三条铁律（AI0）在这里落地成接口约束：
 * ①供应商只能产出**结构化 JSON**（`AiResponse.json`），文档永远由本地收敛层写；
 * ②接口不保存任何状态，快照与历史由 store 负责；
 * ③`MockProvider` 是默认实现，不配 key 也能跑完整个流程（离线可用）。
 */
import type { Doc, NodeId, PageId } from '../core/schema/types'

/** 请求类型：生成页面 / 编辑选区 / 文案候选 / 素材候选 / 生成组件（M7 补后三类） */
export type AiKind = 'page' | 'instruction' | 'plain' | 'text' | 'material' | 'component'

export interface AiRequest {
  kind: AiKind
  /** 用户原话 */
  prompt: string
  /** 结构化上下文：Mock 直接读它，真实供应商由 `buildMessages()` 序列化进 prompt */
  context?: {
    doc: Doc
    pageId: PageId
    /** 选区指令只允许动这些节点（含子孙） */
    selectionIds?: NodeId[]
  }
  /** 编排列好的对话消息（编排层用 `buildMessages()` 填好，供应商可以直接发走） */
  messages?: { role: 'system' | 'user'; content: string }[]
}

export interface AiResponse {
  ok: boolean
  /** 结构化结果：`PageDraft` 或 `{ patches: [...] }` 的形状由 kind 决定 */
  json?: unknown
  /** 供应商原始文本（错误提示/调试用） */
  text?: string
  error?: string
  /** 供应商标识与耗时（面板显示「Mock / 12ms」） */
  provider: string
  ms: number
  /** 真实供应商返回的用量（M7 成本面板；没有就本地估算，见 `usageOf`） */
  usage?: { promptTokens: number; completionTokens: number }
}

export interface AiProvider {
  readonly id: string
  readonly label: string
  /** 是否配置齐全（Mock 永远是 true，真实供应商要 key） */
  readonly ready: boolean
  /** 真实型号（M7 成本面板按它查价格表；Mock 没有） */
  readonly model?: string
  complete(request: AiRequest): Promise<AiResponse>
}

/** 校验失败的原因（三重校验共用一种形状，面板直接列出来） */
export interface AiProblem {
  code: 'shape' | 'normalize' | 'reference' | 'self-check' | 'scope' | 'provider'
  message: string
}
