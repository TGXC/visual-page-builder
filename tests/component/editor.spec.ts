import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { nextTick } from 'vue'
import '@/fields'
import EditorShell from '@/components/editor/EditorShell.vue'
import { childrenOf } from '@/core/tree'
import { useSchemaStore } from '@/stores/schema'
import { loadSchema } from '@/stores/persist'
import type { FormSchema } from '@/core/types'

const FIELD_HEIGHT = 60

/**
 * jsdom 里每个元素的 getBoundingClientRect 都是 0×0，
 * 这里按 DOM 顺序把画布字段排成一条竖线，让「落点 → 插入位」的数学可验证。
 */
function layoutDocument(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
    const fields = Array.from(document.querySelectorAll('.fb-field'))
    const index = fields.indexOf(this)
    const top = index >= 0 ? index * FIELD_HEIGHT : 0
    const height = index >= 0 ? FIELD_HEIGHT : 400
    return {
      left: 0,
      top,
      width: 600,
      height,
      right: 600,
      bottom: top + height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  })
}

/** jsdom 没有 PointerEvent，用普通 Event 挂上指针字段即可（处理器是结构化读取的）。 */
function pointerEvent(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0, buttons: 1 })
  return event
}

let pinia: Pinia
let wrapper: VueWrapper

const store = () => useSchemaStore()
const fieldNames = () => childrenOf(store().schema.fields, null).map(f => f.name)
const orders = (schema: FormSchema) => childrenOf(schema.fields, null).map(f => f.order)
const fieldEls = (): Element[] => wrapper.findAll('.fb-field').map(w => w.element)

async function press(element: Element, x: number, y: number): Promise<void> {
  element.dispatchEvent(pointerEvent('pointerdown', x, y))
  await nextTick()
}

async function moveTo(x: number, y: number): Promise<void> {
  window.dispatchEvent(pointerEvent('pointermove', x, y))
  await nextTick()
}

async function release(x: number, y: number): Promise<void> {
  window.dispatchEvent(pointerEvent('pointerup', x, y))
  await nextTick()
}

/** 完整拖拽：先挪 2px（不该触发），再挪到目标（超过 5px 阈值），最后放手 */
async function drag(element: Element, from: [number, number], to: [number, number]): Promise<void> {
  await press(element, from[0], from[1])
  await moveTo(from[0], from[1] + 2)
  await moveTo(to[0], to[1])
  await release(to[0], to[1])
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  layoutDocument()
  pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
})

afterEach(() => {
  wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('组件面板', () => {
  it('列出所有已注册字段', () => {
    const items = wrapper.findAll('.fb-palette__item')

    // M7 补齐 11 类之后，面板内容仍然完全来自注册表（见 tests/unit/registry.spec.ts）
    expect(items.map(item => item.attributes('data-type'))).toEqual([
      'text',
      'textarea',
      'number',
      'select',
      'radio',
      'checkbox',
      'switch',
      'date',
      'rating',
      'divider',
      'group',
    ])
    expect(items.map(item => item.text())).toEqual(
      expect.arrayContaining([expect.stringContaining('单行文本'), expect.stringContaining('下拉选择')]),
    )
  })

  it('点击面板项就在画布末尾新增字段', async () => {
    await wrapper.findAll('.fb-palette__item')[0].trigger('click')
    await nextTick()

    expect(fieldNames()).toEqual(['name', 'age', 'city', 'text1'])
    expect(wrapper.findAll('.fb-field')).toHaveLength(4)
  })
})

describe('拖拽', () => {
  it('从面板拖到画布：按落点插入', async () => {
    // 三个已有字段中点分别是 30 / 90 / 150，落在 50 → 插到第 1 位（age 之前）
    await drag(wrapper.findAll('.fb-palette__item')[0].element, [0, 0], [400, 50])

    expect(fieldNames()).toEqual(['name', 'text1', 'age', 'city'])
  })

  it('拖动已有字段排序：第一个拖到末尾', async () => {
    // 200 低于所有中点 → 视觉插入位 3；扣掉自己 → order 2
    await drag(fieldEls()[0], [0, 10], [400, 200])

    expect(fieldNames()).toEqual(['age', 'city', 'name'])
  })

  it('拖动过程中不改 schema，只在放手时提交一次', async () => {
    const before = JSON.stringify(store().schema)

    await press(fieldEls()[0], 0, 0)
    await moveTo(0, 200)
    expect(JSON.stringify(store().schema)).toBe(before)

    await release(0, 200)
    expect(JSON.stringify(store().schema)).not.toBe(before)
  })

  it('位移不到 5px 不算拖拽：只选中，不改顺序', async () => {
    const target = fieldEls()[1]
    await press(target, 0, 0)
    await moveTo(0, 3)
    await release(0, 3)

    expect(fieldNames()).toEqual(['name', 'age', 'city'])
    expect(store().selectedIds).toEqual([childrenOf(store().schema.fields, null)[1].id])
  })

  it('拖拽中按 Escape 取消：顺序不变', async () => {
    await press(fieldEls()[0], 0, 0)
    await moveTo(0, 200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    await release(0, 200)

    expect(fieldNames()).toEqual(['name', 'age', 'city'])
  })
})

describe('键盘快捷键', () => {
  it('Delete 删除选中字段，Ctrl+D 复制选中字段', async () => {
    await press(fieldEls()[1], 0, 0)
    await release(0, 0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await nextTick()
    expect(fieldNames()).toEqual(['name', 'city'])

    await press(fieldEls()[0], 0, 0)
    await release(0, 0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }))
    await nextTick()
    expect(fieldNames()).toEqual(['name', 'text1', 'city'])
  })

  it('在输入框里按 Delete 不删字段（否则改标题会误删）', async () => {
    await press(fieldEls()[0], 0, 0)
    await release(0, 0)

    const input = wrapper.find('.fb-prop__label-input').element
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await nextTick()

    expect(fieldNames()).toEqual(['name', 'age', 'city'])
  })
})

describe('属性面板', () => {
  it('选中字段后由 propSchema 生成控件，改标题立刻反映到画布', async () => {
    await press(fieldEls()[0], 0, 0)
    await release(0, 0)

    const labelInput = wrapper.find('.fb-prop__label-input')
    expect((labelInput.element as HTMLInputElement).value).toBe('姓名')
    expect(wrapper.find('[data-key="placeholder"]').exists()).toBe(true)

    await labelInput.setValue('真实姓名')
    await nextTick()
    expect(wrapper.findAll('.fb-field__label')[0].text()).toBe('真实姓名')

    await wrapper.find('[data-key="placeholder"]').setValue('写你的名字')
    expect(store().selectedField?.props.placeholder).toBe('写你的名字')
  })

  it('没有选中字段时显示空状态', () => {
    expect(wrapper.find('.fb-prop__empty').exists()).toBe(true)
  })

  it('点击画布空白处取消选中', async () => {
    await press(fieldEls()[0], 0, 0)
    await release(0, 0)
    expect(store().selectedIds).toHaveLength(1)

    await wrapper.find('.fb-canvas').trigger('pointerdown')
    expect(store().selectedIds).toEqual([])
  })
})

describe('自动保存', () => {
  it('结构变更后写入 localStorage，刷新（新建 store）后顺序保留', async () => {
    await drag(fieldEls()[0], [0, 10], [400, 200])
    await nextTick()
    vi.advanceTimersByTime(400)

    const saved = loadSchema()
    expect(saved).not.toBeNull()
    expect(childrenOf(saved!.fields, null).map(f => f.name)).toEqual(['age', 'city', 'name'])
  })
})

describe('M3 验收：拖入 10 个字段、任意排序、刷新后顺序保留', () => {
  it('从面板连拖 10 个 → 重排 → 刷新后顺序与内容完全一致', async () => {
    const sources = wrapper.findAll('.fb-palette__item').map(item => item.element)

    // 每次都落在所有字段下方 → 追加到末尾（字段变高也不用改坐标）
    for (let index = 0; index < 10; index += 1) {
      await drag(sources[index % sources.length], [0, 0], [400, 1000])
    }
    expect(fieldNames()).toHaveLength(13)
    expect(orders(store().schema)).toEqual(Array.from({ length: 13 }, (_, index) => index))

    // 任意排序：把第一个拖到末尾，再把末尾那个拖到第 5 位
    await drag(fieldEls()[0], [0, 10], [400, 2000])
    await drag(fieldEls()[12], [0, 720], [400, 310])

    const beforeNames = fieldNames()
    const beforeJson = JSON.stringify(store().schema)
    expect(beforeNames).toHaveLength(13)

    // 等防抖写入完成，再「刷新」：换一个 pinia 重新挂载，store 只能从 localStorage 恢复
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(loadSchema()).not.toBeNull()

    wrapper.unmount()
    pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })

    expect(fieldNames()).toEqual(beforeNames)
    expect(JSON.stringify(store().schema)).toBe(beforeJson)
  })
})

/** 键盘事件：Ctrl/Cmd+Z 撤销、Ctrl+Shift+Z 重做 */
function pressKey(key: string, options: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
}

describe('历史记录面板', () => {
  it('列出「初始状态」与每一步操作，当前步有高亮', async () => {
    expect(wrapper.findAll('.fb-history__item')).toHaveLength(1)
    expect(wrapper.get('.fb-history__item').text()).toBe('初始状态')

    await drag(fieldEls()[0], [0, 10], [400, 200])

    const items = wrapper.findAll('.fb-history__item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toBe('初始状态')
    expect(items[1].text()).toBe('移动字段')
    expect(items[1].classes()).toContain('fb-history__item--current')
  })

  it('点击历史项就跳回那一步', async () => {
    const start = JSON.stringify(store().schema)
    await drag(fieldEls()[0], [0, 10], [400, 200])
    expect(fieldNames()).toEqual(['age', 'city', 'name'])

    await wrapper.findAll('.fb-history__item')[0].trigger('click')
    await nextTick()

    expect(JSON.stringify(store().schema)).toBe(start)
    expect(wrapper.findAll('.fb-history__item')[0].classes()).toContain('fb-history__item--current')
  })

  it('Ctrl+Z 撤销、Ctrl+Shift+Z 重做', async () => {
    await drag(fieldEls()[0], [0, 10], [400, 200])
    const moved = fieldNames()

    pressKey('z', { ctrlKey: true })
    await nextTick()
    expect(fieldNames()).toEqual(['name', 'age', 'city'])

    pressKey('Z', { ctrlKey: true, shiftKey: true })
    await nextTick()
    expect(fieldNames()).toEqual(moved)
  })
})

describe('M4 验收：连续输入合并成一步', () => {
  it('两次快速输入只留一条历史，撤销一次即回到原值', async () => {
    await press(fieldEls()[0], 0, 10)
    const input = wrapper.get('.fb-prop__label-input')

    await input.setValue('张')
    vi.advanceTimersByTime(80)
    await input.setValue('张三')

    expect(wrapper.findAll('.fb-history__item').map(item => item.text())).toEqual(['初始状态', '修改标签'])
    expect(store().fieldById.get(store().selectedId!)!.label).toBe('张三')

    pressKey('z', { ctrlKey: true })
    await nextTick()
    expect(store().schema.fields[0].label).toBe('姓名')
  })
})
