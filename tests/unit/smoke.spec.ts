import { describe, expect, it } from 'vitest'

/**
 * M0 占位测试：只证明测试链路（Vite + Vitest + jsdom + TS 别名）是通的。
 * M1 开始这里会被 tests/unit/*.spec.ts 的真实用例取代。
 */
describe('M0 脚手架', () => {
  it('测试运行器能跑通断言', () => {
    expect(1 + 1).toBe(2)
  })

  it('运行在 jsdom 环境里', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').tagName).toBe('DIV')
  })
})
