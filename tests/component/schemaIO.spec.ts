import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SchemaActions from '@/components/editor/SchemaActions.vue'
import { toJsonText } from '@/core/schema'
import { decodeSchema } from '@/core/share'
import { demoSchema } from '@/data/demoSchema'
import type { FormSchema } from '@/core/types'
import { makeField, makeSchema } from '../unit/factories'

function shareQueryOf(wrapper: VueWrapper): string {
  const value = wrapper.find<HTMLInputElement>('.fb-io__share-link').element.value
  return new URL(value).searchParams.get('d') ?? ''
}

async function selectFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.find<HTMLInputElement>('input.fb-io__file')
  const file = new File([text], 'form.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await new Promise(resolve => setTimeout(resolve, 0))
}

function longSchema(count: number): FormSchema {
  const fields = Array.from({ length: count }, (_, i) =>
    makeField({
      id: `f_${i}`,
      type: 'text',
      name: `field_${i}`,
      label: Array.from({ length: 40 }, (_, j) => String.fromCharCode(97 + ((i * 31 + j * 17) % 26))).join('') + i,
      order: i,
    }),
  )
  return makeSchema(fields)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SchemaActions：导出 / 导入 / 分享', () => {
  it('渲染导出、导入、分享三件事，分享链接里能解回同一份 schema', () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    expect(wrapper.find('.fb-io__export').text()).toContain('导出')
    expect(wrapper.find('input.fb-io__file').exists()).toBe(true)
    expect(decodeSchema(shareQueryOf(wrapper))).toEqual(demoSchema)
  })

  it('导出：把格式化后的 JSON 交给下载', async () => {
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await wrapper.find('.fb-io__export').trigger('click')

    expect(click).toHaveBeenCalledTimes(1)
    expect(blobs).toHaveLength(1)
    expect(await blobs[0]!.text()).toBe(toJsonText(demoSchema))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('导入合法文件：规范化之后 emit import', async () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await selectFile(
      wrapper,
      JSON.stringify({
        version: 1,
        id: 'imported',
        name: '导入的表单',
        fields: [{ id: 'a', type: 'text', label: 'A' }],
      }),
    )

    const events = wrapper.emitted('import')
    expect(events).toHaveLength(1)
    const schema = events![0]![0] as FormSchema
    expect(schema.name).toBe('导入的表单')
    expect(schema.fields[0]).toMatchObject({ id: 'a', type: 'text', label: 'A', name: 'text', props: {} })
  })

  it('导入坏 JSON：报错、不 emit', async () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await selectFile(wrapper, '{ 这不是 json')

    expect(wrapper.find('.fb-io__error').text()).toBe('不是合法的 JSON 文件')
    expect(wrapper.emitted('import')).toBeUndefined()
  })

  it('导入 JSON 但不是表单文件：报错、不 emit', async () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await selectFile(wrapper, JSON.stringify({ version: 2, fields: [] }))

    expect(wrapper.find('.fb-io__error').text()).toContain('不是有效的表单文件')
    expect(wrapper.emitted('import')).toBeUndefined()
  })

  it('导入成功后再导入坏文件，会显示新的错误', async () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await selectFile(wrapper, JSON.stringify({ version: 1, id: 'x', name: 'ok', fields: [] }))
    expect(wrapper.emitted('import')).toHaveLength(1)
    await selectFile(wrapper, 'x')
    expect(wrapper.find('.fb-io__error').text()).toBe('不是合法的 JSON 文件')
  })

  it('复制链接：剪贴板可用时写入并提示已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    const link = wrapper.find<HTMLInputElement>('.fb-io__share-link').element.value
    await wrapper.find('.fb-io__copy').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(writeText).toHaveBeenCalledWith(link)
    expect(wrapper.find('.fb-io__copied').exists()).toBe(true)
  })

  it('复制链接：剪贴板不可用时让人自己复制，不假装成功', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    await wrapper.find('.fb-io__copy').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.find('.fb-io__copied').exists()).toBe(false)
    expect(wrapper.find('.fb-io__error').text()).toContain('请手动选中链接复制')
  })

  it('链接超长时给出改用导出的提示', () => {
    expect(mount(SchemaActions, { props: { schema: demoSchema } }).find('.fb-io__warn').exists()).toBe(false)
    expect(mount(SchemaActions, { props: { schema: longSchema(120) } }).find('.fb-io__warn').exists()).toBe(true)
  })

  it('schema 变了，分享链接跟着变', async () => {
    const wrapper = mount(SchemaActions, { props: { schema: demoSchema } })
    const before = shareQueryOf(wrapper)
    const renamed: FormSchema = { ...demoSchema, name: '换了个名字' }
    await wrapper.setProps({ schema: renamed })

    expect(shareQueryOf(wrapper)).not.toBe(before)
    expect(decodeSchema(shareQueryOf(wrapper))?.name).toBe('换了个名字')
  })
})
