import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import '@/fields'
import App from '@/App.vue'
import Canvas from '@/components/editor/Canvas.vue'
import FormRenderer from '@/components/runtime/FormRenderer.vue'
import { routes } from '@/router'
import { demoSchema } from '@/data/demoSchema'
import type { FieldNode, FormSchema } from '@/core/types'

const labelsOf = (wrapper: { findAll: (s: string) => Array<{ text: () => string }> }): string[] =>
  wrapper.findAll('.fb-field__label').map(el => el.text())

const makeSchema = (fields: FieldNode[]): FormSchema => ({
  version: 1,
  id: 's',
  name: '',
  description: '',
  fields,
  settings: { labelPosition: 'top', submitText: '提交' },
})

describe('双渲染路径：同一份 schema', () => {
  it('Canvas 与 FormRenderer 渲染出的字段标签与顺序完全一致', () => {
    const canvas = mount(Canvas, { props: { schema: demoSchema } })
    const renderer = mount(FormRenderer, { props: { schema: demoSchema } })

    const expected = ['姓名', '年龄', '所在城市']
    expect(labelsOf(canvas)).toEqual(expected)
    expect(labelsOf(renderer)).toEqual(expected)
    expect(labelsOf(canvas)).toEqual(labelsOf(renderer))
  })

  it('渲染顺序由 order 决定，与 fields 数组的摆放顺序无关', () => {
    const [name, age, city] = demoSchema.fields
    const shuffled = makeSchema([city, name, age])

    expect(labelsOf(mount(Canvas, { props: { schema: shuffled } }))).toEqual(['姓名', '年龄', '所在城市'])
    expect(labelsOf(mount(FormRenderer, { props: { schema: shuffled } }))).toEqual(['姓名', '年龄', '所在城市'])
  })

  it('换一份 schema，两条路径渲染出的内容都跟着变（同一份 JSON 驱动）', () => {
    const other = makeSchema([
      { id: 'x1', parentId: null, order: 0, type: 'text', name: 'title', label: '标题', props: {}, rules: [], visibleWhen: null },
    ])

    expect(labelsOf(mount(Canvas, { props: { schema: other } }))).toEqual(['标题'])
    expect(labelsOf(mount(FormRenderer, { props: { schema: other } }))).toEqual(['标题'])
  })
})

describe('两条路由：/ 与 /preview', () => {
  it('同一份 schema 在两个页面都渲染正确（M2 验收）', async () => {
    // 编辑页现在是完整的编辑器（面板 + store），所以要给一个干净的 pinia 与空存档
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    expect(labelsOf(wrapper)).toEqual(['姓名', '年龄', '所在城市'])
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)

    await router.push('/preview')
    await flushPromises()

    expect(labelsOf(wrapper)).toEqual(['姓名', '年龄', '所在城市'])
    expect(wrapper.find('button[type="submit"]').text()).toBe('提交报名')
  })
})

describe('哑组件：字段控件只认 value 与 props', () => {
  it('每种字段渲染出对应的原生控件', () => {
    const wrapper = mount(FormRenderer, { props: { schema: demoSchema } })

    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
    expect(wrapper.find('input[type="number"]').exists()).toBe(true)
    expect(wrapper.find('select').exists()).toBe(true)
  })

  it('field.props 透传给控件（placeholder / maxlength）', () => {
    const wrapper = mount(FormRenderer, { props: { schema: demoSchema } })
    const text = wrapper.find('input[type="text"]')

    expect(text.attributes('placeholder')).toBe('请输入真实姓名')
    expect(text.attributes('maxlength')).toBe('20')
  })

  it('select 的选项来自 props.options，placeholder 作为占位项', () => {
    const wrapper = mount(FormRenderer, { props: { schema: demoSchema } })
    const options = wrapper.findAll('select option')

    expect(options.map(o => o.text())).toEqual(['请选择城市', '北京', '上海', '深圳'])
  })

  it('控件是受控的：输入只 emit update:value，自己不保存状态', async () => {
    const TextInput = (await import('@/components/shared/fields/TextInput.vue')).default
    const wrapper = mount(TextInput, { props: { value: '旧值' } })

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('旧值')

    await wrapper.find('input').setValue('新值')
    expect(wrapper.emitted('update:value')?.[0]).toEqual(['新值'])

    // 没有内部状态：值只跟着外部 prop 走
    await wrapper.setProps({ value: '外部更新' })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('外部更新')
  })
})

describe('运行态与编辑态的区别', () => {
  it('FormRenderer 显示提交按钮，文案来自 settings.submitText', () => {
    const wrapper = mount(FormRenderer, { props: { schema: demoSchema } })
    const button = wrapper.find('button[type="submit"]')

    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('提交报名')
  })

  it('Canvas 是编辑态：只渲染，没有提交按钮', () => {
    const wrapper = mount(Canvas, { props: { schema: demoSchema } })

    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
  })

  it('空表单时两条路径都给出占位提示', () => {
    const empty = makeSchema([])

    expect(mount(Canvas, { props: { schema: empty } }).find('.fb-empty').exists()).toBe(true)
    expect(mount(FormRenderer, { props: { schema: empty } }).find('.fb-empty').exists()).toBe(true)
  })
})
