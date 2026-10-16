import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * M2：store 必须把「文本测量」注入布局引擎。
 *
 * 真实测量需要浏览器的 Canvas 2D 上下文，jsdom 里拿不到，所以这里把 `textMeasure`
 * 整体 mock 掉，断言 `hug` 文本节点的盒子用了注入的测量值 —— 只要 store 忘了透传
 * `measure`，盒子就会退回字符估算（宽度不会是 123），用例立刻失败。
 */
vi.mock('@/utils/textMeasure', () => ({
  FONT_STACK: 'stub',
  measureText: vi.fn(() => ({ w: 123, h: 45 })),
}))

import { useEditorStore } from '@/stores/editor'

describe('M2 测量注入：store 把 textMeasure 传给 computeLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hug 文本节点的盒子尺寸来自测量函数', () => {
    const store = useEditorStore()
    store.newProject()
    const id = store.insertComponent('text', { position: { x: 0, y: 0 } })
    store.updateNode(id, { props: { text: '一段足够长的说明文字' } })
    store.updateLayout(id, { size: { w: { kind: 'hug', value: 0 }, h: { kind: 'hug', value: 0 } } })

    const box = store.boxes[id]
    expect(box).toBeDefined()
    expect(box.w).toBe(123)
    expect(box.h).toBe(45)
    expect(store.layout.estimated).not.toContain(id)
  })
})
