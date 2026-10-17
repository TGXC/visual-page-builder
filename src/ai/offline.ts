/**
 * M7 离线降级（功能文档 AI6：失败降级 = 明确报错 + 保留现场 + 改用规则助手）。
 *
 * 判定很薄（只看 `navigator.onLine`），但**兜底逻辑在 store 里**：
 * 供应商失败或断网时，store 直接调 `src/ai/text.ts` / `material.ts` / `component.ts`
 * 里的规则式实现 —— 那些函数不碰网络，所以「不配 key 也能用」是真的。
 */

export const OFFLINE_HINT = '当前没有网络：已改用内置规则助手（离线可用）'
export const PROVIDER_FALLBACK_HINT = '供应商不可用：已改用内置规则助手'

export interface OnlineLike {
  onLine?: boolean
}

/** 只认显式 `onLine === false`；服务器/测试环境没有 navigator 时视为在线 */
export function isOffline(target?: OnlineLike): boolean {
  const nav = target ?? (typeof navigator === 'undefined' ? undefined : (navigator as OnlineLike))
  return nav?.onLine === false
}

/** 供应商失败是否该降级到规则助手：断网、没有 key、或调用直接报 provider 错 */
export function shouldFallback(codes: readonly string[], offline: boolean): boolean {
  return offline || codes.includes('provider')
}
