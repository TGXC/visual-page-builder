import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EditorShell from '@/components/editor/EditorShell.vue'
import FormRenderer from '@/components/runtime/FormRenderer.vue'
import { childrenOf } from '@/core/tree'
import { useSchemaStore } from '@/stores/schema'
import { makeField, makeSchema } from '../unit/factories'
import type { FieldNode, FormSchema } from '@/core/types'

/** 布局是假的：按 .fb-field 的 DOM 下标排竖线，容器元素用它的子孙包一个框。 */
const FIELD_HEIGHT = 60

function rect(top: number, height: number) {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function layout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const all = Array.from(document.querySelectorAll('.fb-field'))
    const index = all.indexOf(this)
    if (index < 0) return rect(0, 400)

    // 容器（分组）包住自己的子孙，跨容器拖拽才有几何可判
    if (this.getAttribute('data-container') === 'true') {
      const inner = Array.from(this.querySelectorAll('.fb-field')).map(el => all.indexOf(el))
      const top = Math.min(...inner) * FIELD_HEIGHT
      const bottom = (Math.max(...inner) + 1) * FIELD_HEIGHT
      return rect(top, bottom - top)
    }

    return rect(index * FIELD_HEIGHT, FIELD_HEIGHT)
  })
}

function pointerEvent(type: string, x: number, y: number): Event {
  // jsdom 没有 PointerEvent，用普通 Event 补上拖拽用到的字段
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0, buttons: 1 })
  return event
}

const press = (el: Element, x: number, y: number): void => void el.dispatchEvent(pointerEvent('pointerdown', x, y))
const moveTo = (x: number, y: number): void => void window.dispatchEvent(pointerEvent('pointermove', x, y))
const release = (x: number, y: number): void => void window.dispatchEvent(pointerEvent('pointerup', x, y))

const groupField = (id: string, order: number, extra: Partial<FieldNode> = {}): FieldNode =>
  makeField({ id, type: 'group', name: id, label: '联系人', order, ...extra })

/** 根层：联系人分组（姓名 + 电话） + 城市 */
function nestedSchema(): FormSchema {
  return makeSchema([
    groupField('g1', 0),
    makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', parentId: 'g1', order: 0 }),
    makeField({ id: 'f_phone', type: 'text', name: 'phone', label: '电话', parentId: 'g1', order: 1 }),
    makeField({ id: 'f_city', type: 'text', name: 'city', label: '城市', order: 1 }),
  ])
}

const labelsOf = (wrapper: { findAll: (s: string) => Array<{ text: () => string }> }): string[] =>
  wrapper.findAll('.fb-field__label').map(el => el.text())

describe('分组：编辑态嵌套渲染', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    layout()
    wrapper = mount(EditorShell, { global: { plugins: [pinia] }, attachTo: document.body })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('按层级渲染分组与组内字段（顺序是树前序）', async () => {
    useSchemaStore().setSchema(nestedSchema())
    await nextTick()

    expect(labelsOf(wrapper!)).toEqual(['联系人', '姓名', '电话', '城市'])
    expect(wrapper!.find('[data-field-id="g1"] [data-field-id="f_name"]').exists()).toBe(true)
    expect(wrapper!.find('[data-field-id="g1"] [data-field-id="f_city"]').exists()).toBe(false)
  })

  it('分组字段带容器标记，子字段挂在自己的字段列表下', async () => {
    useSchemaStore().setSchema(nestedSchema())
    await nextTick()

    const group = wrapper!.find('[data-field-id="g1"]')
    expect(group.classes()).toContain('fb-field--container')
    expect(group.attributes('data-container')).toBe('true')
    expect(group.find('.fb-field-list[data-parent-id="g1"]').exists()).toBe(true)
  })

  it('把根层字段拖进分组：换父级，且组内顺序按落点算', async () => {
    const store = useSchemaStore()
    store.setSchema(nestedSchema())
    await nextTick()

    const fieldEls = wrapper!.findAll('.fb-field').map(w => w.element)
    // 拖城市（DOM 第 4 个，y≈180..240）落到分组框内的第 2 个孩子位置（y=100）
    press(fieldEls[3]!, 0, 200)
    moveTo(400, 100)
    release(400, 100)
    await nextTick()

    expect(store.fieldById.get('f_city')!.parentId).toBe('g1')
    expect(childrenOf(store.schema.fields, 'g1').map(f => f.name)).toEqual(['name', 'city', 'phone'])
    expect(childrenOf(store.schema.fields, 'g1').map(f => f.order)).toEqual([0, 1, 2])
  })

  it('分组拖不进自己里面（不会造出环）', async () => {
    const store = useSchemaStore()
    store.setSchema(nestedSchema())
    await nextTick()

    const fieldEls = wrapper!.findAll('.fb-field').map(w => w.element)
    press(fieldEls[0]!, 0, 30)
    moveTo(400, 100)
    release(400, 100)
    await nextTick()

    expect(store.fieldById.get('g1')!.parentId).toBeNull()
    expect(childrenOf(store.schema.fields, null).map(f => f.name)).toEqual(['g1', 'city'])
  })
})

describe('分组：运行态嵌套渲染', () => {
  it('分组与组内字段都渲染，分组标签由宿主渲染', () => {
    const wrapper = mount(FormRenderer, { props: { schema: nestedSchema(), values: {} } })

    expect(labelsOf(wrapper)).toEqual(['联系人', '姓名', '电话', '城市'])
    expect(wrapper.find('.fb-group-field[data-field-id="g1"]').exists()).toBe(true)
    // 分组本身不是可填字段（.fb-group-field），只有叶子是 .fb-field
    expect(wrapper.findAll('.fb-field')).toHaveLength(3)
    expect(wrapper.findAll('.fb-field, .fb-group-field')).toHaveLength(4)
  })

  it('分组条件为假时，整棵子树都不渲染', async () => {
    const schema = makeSchema([
      makeField({ id: 'f_show', type: 'text', name: 'show', label: '要不要填', order: 0 }),
      groupField('g1', 1, { visibleWhen: { field: 'show', op: 'eq', value: 'yes' } }),
      makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', parentId: 'g1', order: 0 }),
    ])
    const wrapper = mount(FormRenderer, { props: { schema, values: {} } })
    expect(labelsOf(wrapper)).toEqual(['要不要填'])

    await wrapper.setProps({ values: { show: 'yes' } })
    expect(labelsOf(wrapper)).toEqual(['要不要填', '联系人', '姓名'])
  })

  it('组内字段的值照样绑到 runtime 的字段名上', async () => {
    const wrapper = mount(FormRenderer, { props: { schema: nestedSchema(), values: {} } })
    const inputs = wrapper.findAll('input[type="text"]')

    await inputs[0]!.setValue('张三')

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['name', '张三'])
  })
})
