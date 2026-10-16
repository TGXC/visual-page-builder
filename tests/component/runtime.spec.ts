import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import PreviewView from '@/views/PreviewView.vue'
import { useSchemaStore } from '@/stores/schema'
import { useRuntimeStore } from '@/stores/runtime'
import { makeField, makeSchema } from '../unit/factories'
import type { FieldNode } from '@/core/types'

let scrollSpy: ReturnType<typeof vi.fn>

const name = (): FieldNode =>
  makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', rules: [{ kind: 'required' }] })
const age = (): FieldNode => makeField({ id: 'f_age', type: 'number', name: 'age', label: '年龄' })
const hasPet = (): FieldNode => makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' })
const petName = (): FieldNode =>
  makeField({
    id: 'f_pet',
    type: 'text',
    name: 'pet',
    label: '宠物名',
    rules: [{ kind: 'required' }],
    visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
  })

function mountPreview(fields: FieldNode[]) {
  const pinia: Pinia = createPinia()
  setActivePinia(pinia)
  const schema = useSchemaStore(pinia)
  schema.setSchema(makeSchema(fields))
  const wrapper = mount(PreviewView, { global: { plugins: [pinia] } })
  return { wrapper, schema, runtime: useRuntimeStore(pinia) }
}

const labelsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('.fb-field__label').map(el => el.text())

const errorsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('.fb-field__error').map(el => el.text())

describe('预览页：填值、校验、提交', () => {
  beforeEach(() => {
    localStorage.clear()
    scrollSpy = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollSpy,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
  })

  it('按 schema 渲染字段与提交按钮文案', () => {
    const { wrapper } = mountPreview([name(), age()])
    expect(labelsOf(wrapper)).toEqual(['姓名', '年龄'])
    expect(wrapper.find('button[type=submit]').text()).toBe('提交')
  })

  it('打字写进 runtime.values', async () => {
    const { wrapper, runtime } = mountPreview([name(), age()])
    await wrapper.find('input[type=text]').setValue('张三')
    await wrapper.find('input[type=number]').setValue('30')
    expect(runtime.values).toEqual({ name: '张三', age: 30 })
  })

  it('必填为空时提交：显示错误、不产生提交结果、并滚动到第一个出错的字段', async () => {
    const { wrapper, runtime } = mountPreview([name(), age()])
    await wrapper.find('form').trigger('submit')
    expect(errorsOf(wrapper)).toEqual(['姓名不能为空'])
    expect(runtime.submitted).toBeNull()
    expect(wrapper.find('.fb-submitted').exists()).toBe(false)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' })
  })

  it('填好后提交：输出 FormValues 并显示出来，不再滚动', async () => {
    const { wrapper, runtime } = mountPreview([name(), age()])
    await wrapper.find('input[type=text]').setValue('张三')
    await wrapper.find('input[type=number]').setValue('30')
    await wrapper.find('form').trigger('submit')
    expect(errorsOf(wrapper)).toEqual([])
    expect(runtime.submitted).toEqual({ name: '张三', age: 30 })
    expect(wrapper.find('.fb-submitted').text()).toContain('"name": "张三"')
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('隐藏字段不渲染、也不参与校验', async () => {
    const { wrapper } = mountPreview([hasPet(), petName()])
    expect(labelsOf(wrapper)).toEqual(['有宠物吗'])
    await wrapper.find('form').trigger('submit')
    expect(errorsOf(wrapper)).toEqual([])
    expect(wrapper.find('.fb-submitted').exists()).toBe(true)
  })

  it('条件满足后目标字段出现并参与校验', async () => {
    const { wrapper } = mountPreview([hasPet(), petName()])
    await wrapper.find('input[type=text]').setValue('yes')
    expect(labelsOf(wrapper)).toEqual(['有宠物吗', '宠物名'])
    await wrapper.find('form').trigger('submit')
    expect(errorsOf(wrapper)).toEqual(['宠物名不能为空'])
  })

  it('报错后一改值，这条错误立刻消失', async () => {
    const { wrapper } = mountPreview([name()])
    await wrapper.find('form').trigger('submit')
    expect(errorsOf(wrapper)).toEqual(['姓名不能为空'])
    await wrapper.find('input[type=text]').setValue('张')
    expect(errorsOf(wrapper)).toEqual([])
  })

  it('上一次的提交结果在下一次提交失败时消失', async () => {
    const { wrapper } = mountPreview([name()])
    await wrapper.find('input[type=text]').setValue('张三')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.fb-submitted').exists()).toBe(true)
    await wrapper.find('input[type=text]').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.fb-submitted').exists()).toBe(false)
    expect(errorsOf(wrapper)).toEqual(['姓名不能为空'])
  })

  it('提交结果里不含已经隐藏的字段', async () => {
    const { wrapper, runtime } = mountPreview([hasPet(), petName()])
    await wrapper.find('input[type=text]').setValue('yes')
    await wrapper.findAll('input[type=text]')[1].setValue('旺财')
    expect(runtime.values).toEqual({ has: 'yes', pet: '旺财' })
    await wrapper.findAll('input[type=text]')[0].setValue('no')
    await wrapper.find('form').trigger('submit')
    expect(runtime.submitted).toEqual({ has: 'no' })
  })

  it('空 schema 时给出空状态且不渲染提交按钮以外的内容', () => {
    const { wrapper } = mountPreview([])
    expect(wrapper.find('.fb-empty').text()).toBe('这张表单还没有字段')
    expect(wrapper.find('button[type=submit]').exists()).toBe(true)
  })
})
