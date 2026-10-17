/**
 * M7 离线降级判定（src/ai/offline.ts）：薄封装，真正的兜底在 store 里
 * （供应商失败 → 直接调规则式实现）。
 */
import { describe, expect, it } from 'vitest'
import { OFFLINE_HINT, PROVIDER_FALLBACK_HINT, isOffline, shouldFallback } from '@/ai/offline'

describe('M7 离线降级（src/ai/offline.ts）', () => {
  it('只有显式 onLine === false 才算离线', () => {
    expect(isOffline({ onLine: false })).toBe(true)
    expect(isOffline({ onLine: true })).toBe(false)
    expect(isOffline({})).toBe(false)
    expect(isOffline(undefined)).toBe(false)
  })

  it('断网或 provider 类错误都该降级', () => {
    expect(shouldFallback(['provider'], false)).toBe(true)
    expect(shouldFallback(['shape'], true)).toBe(true)
    expect(shouldFallback(['shape'], false)).toBe(false)
    expect(shouldFallback([], false)).toBe(false)
  })

  it('降级文案明确说了「改用规则助手」', () => {
    expect(OFFLINE_HINT).toContain('离线')
    expect(PROVIDER_FALLBACK_HINT).toContain('规则助手')
  })
})
