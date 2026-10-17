/**
 * M7 成本面板的基础算账（src/ai/usage.ts）：token 估算 + 价格表 + 记录汇总。
 * 对应功能文档 AI6「Token 与成本」。
 */
import { describe, expect, it } from 'vitest'
import { PRICING, estimateCost, estimateTokens, formatUsage, usageOf } from '@/ai/usage'
import { createAiService } from '@/ai'

describe('M7 token 与成本（src/ai/usage.ts）', () => {
  it('token 估算：空串为 0，CJK 按字数，ASCII 按 4 字符 1 token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('   ')).toBe(0)
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('你好abcd')).toBe(3)
  })

  it('价格表与费用计算（USD / 1M tokens）', () => {
    expect(PRICING['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.6 })
    expect(estimateCost('gpt-4o-mini', 1_000_000, 1_000_000)).toBe(0.75)
    expect(estimateCost('gpt-4o-mini', 2000, 500)).toBe(0.0006)
    expect(estimateCost('unknown-model', 1000, 1000)).toBe(0)
    expect(estimateCost('gpt-4o-mini', 0, 0)).toBe(0)
  })

  it('usageOf 把请求与响应折成一条用量，formatUsage 给面板文案', () => {
    const usage = usageOf(
      { kind: 'page', prompt: '做一个读书会落地页', messages: [{ role: 'user', content: 'x'.repeat(40) }] },
      { ok: true, json: { a: 1 }, provider: 'mock', ms: 3 },
      'gpt-4o-mini',
    )
    expect(usage.promptTokens).toBeGreaterThan(0)
    expect(usage.completionTokens).toBeGreaterThan(0)
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens)
    expect(usage.costUsd).toBeGreaterThan(0)
    expect(formatUsage(usage)).toContain('tokens')
    expect(formatUsage(usage)).toContain('$')
    expect(usageOf({ kind: 'text', prompt: '' }, { ok: false, provider: 'mock', ms: 0 }).totalTokens).toBe(0)
  })

  it('AI 服务的调用记录带上 token 与费用汇总', () => {
    const service = createAiService()
    return service.writeText('给读书会写一句口号').then(() => {
      const logs = service.logs()
      expect(logs).toHaveLength(1)
      expect(logs[0].tokens).toBeGreaterThan(0)
      expect(logs[0].costUsd).toBeGreaterThanOrEqual(0)
      const summary = service.usageSummary()
      expect(summary.calls).toBe(1)
      expect(summary.tokens).toBe(logs[0].tokens)
      service.clearLogs()
      expect(service.usageSummary()).toEqual({ calls: 0, tokens: 0, costUsd: 0, model: summary.model })
    })
  })
})
