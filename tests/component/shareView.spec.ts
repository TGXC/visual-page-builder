import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { encodeSchema } from '@/core/share'
import { loadSchema, saveSchema } from '@/stores/persist'
import ShareView from '@/views/ShareView.vue'
import type { FormSchema } from '@/core/types'
import { makeField, makeSchema } from '../unit/factories'

const shareSchema: FormSchema = makeSchema([
  makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', order: 0, rules: [{ kind: 'required' }] }),
  makeField({ id: 'f_city', type: 'select', name: 'city', label: '城市', order: 1 }),
])

async function mountShare(query: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/share${query}`)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ShareView, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ShareView：链接打开就是可填的表单', () => {
  it('合法链接渲染出分享的字段与提交按钮', async () => {
    const { wrapper } = await mountShare(`?d=${encodeSchema(shareSchema)}`)

    expect(wrapper.findAll('.fb-field__label').map(el => el.text())).toEqual(['姓名', '城市'])
    expect(wrapper.find('button[type=submit]').text()).toBe(shareSchema.settings.submitText)
    expect(wrapper.find('.fb-empty').exists()).toBe(false)
  })

  it('链接缺少或损坏时给出提示，而不是白屏', async () => {
    expect((await mountShare('')).wrapper.find('.fb-empty').text()).toBe('分享链接不完整或已损坏')
    expect((await mountShare('?d=这不是压缩数据')).wrapper.find('.fb-empty').text()).toBe('分享链接不完整或已损坏')
  })

  it('能填值并提交，看到 FormValues', async () => {
    const { wrapper } = await mountShare(`?d=${encodeSchema(shareSchema)}`)

    await wrapper.find('input[type=text]').setValue('张三')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.fb-submitted').exists()).toBe(true)
    expect(wrapper.find('.fb-submitted__json').text()).toContain('张三')
  })

  it('必填为空时提交会报错、不出现结果', async () => {
    const { wrapper } = await mountShare(`?d=${encodeSchema(shareSchema)}`)
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.fb-field__error').exists()).toBe(true)
    expect(wrapper.find('.fb-submitted').exists()).toBe(false)
  })

  it('条件字段跟着值出现', async () => {
    const conditional = makeSchema([
      makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗', order: 0 }),
      makeField({
        id: 'f_pet',
        type: 'text',
        name: 'pet',
        label: '宠物名',
        order: 1,
        visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
      }),
    ])
    const { wrapper } = await mountShare(`?d=${encodeSchema(conditional)}`)

    expect(wrapper.findAll('.fb-field__label').map(el => el.text())).toEqual(['有宠物吗'])
    await wrapper.find('input[type=text]').setValue('yes')
    await flushPromises()
    expect(wrapper.findAll('.fb-field__label').map(el => el.text())).toEqual(['有宠物吗', '宠物名'])
  })

  it('打开别人的分享链接不会覆盖我本地的草稿', async () => {
    const draft = makeSchema([makeField({ id: 'f_draft', type: 'text', name: 'draft', label: '我的草稿' })])
    saveSchema(draft)
    vi.useFakeTimers()

    try {
      const { wrapper } = await mountShare(`?d=${encodeSchema(shareSchema)}`)
      expect(wrapper.findAll('.fb-field__label').map(el => el.text())).toEqual(['姓名', '城市'])

      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(loadSchema()).toEqual(draft)
    } finally {
      vi.useRealTimers()
    }
  })
})
