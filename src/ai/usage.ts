/**
 * M7 token 与成本估算（功能文档 AI6「Token 与成本」）。
 *
 * 说明：这是**本地估算**，不是供应商真实计费 —— 组件目录按需注入（只发选中子树 + 必要上下文）
 * 的收益靠它体现；真实 `usage` 字段若供应商返回也会优先采用（见 `usageOf`）。
 */
import type { AiRequest, AiResponse } from './types'

export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
}

export interface UsageSummary {
  calls: number
  tokens: number
  costUsd: number
  model: string
}

export const PRICING_MODEL = 'gpt-4o-mini'

/** USD / 1M tokens：只放常用型号，查不到就按 0 计（不编造价格） */
export const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
}

/** 粗估：CJK 一字 ≈ 1 token，ASCII 4 字符 ≈ 1 token（空白忽略） */
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  let wide = 0
  let narrow = 0
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0x7f) wide += 1
    else if (!/\s/.test(char)) narrow += 1
  }
  return wide + Math.ceil(narrow / 4)
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICING[model]
  if (!price) return 0
  const cost = (promptTokens * price.input + completionTokens * price.output) / 1_000_000
  return Math.round(cost * 1e6) / 1e6
}

/** 把一次请求 + 响应折成用量（供应商返回真实 usage 时以它为准） */
export function usageOf(request: AiRequest, response: AiResponse, model: string = PRICING_MODEL): AiUsage {
  const promptText =
    request.messages && request.messages.length > 0
      ? request.messages.map((message) => message.content).join('\n')
      : request.prompt
  const reply = response.json !== undefined ? JSON.stringify(response.json) : (response.text ?? '')
  const promptTokens = response.usage?.promptTokens ?? estimateTokens(promptText)
  const completionTokens = response.usage?.completionTokens ?? estimateTokens(reply)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: estimateCost(model, promptTokens, completionTokens),
  }
}

export function formatUsage(usage: AiUsage): string {
  return `${usage.totalTokens.toLocaleString('en-US')} tokens · $${usage.costUsd.toFixed(4)}`
}
