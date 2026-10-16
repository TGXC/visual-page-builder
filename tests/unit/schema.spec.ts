import { describe, expect, it } from 'vitest'
import { createEmptySchema, normalizeSchema, parseSchemaJson, schemaFileName, toJsonText } from '@/core/schema'
import { childrenOf } from '@/core/tree'
import { demoSchema } from '@/data/demoSchema'
import { makeField, makeSchema } from './factories'

describe('createEmptySchema', () => {
  it('给出一份可以直接渲染的空表单', () => {
    const schema = createEmptySchema()
    expect(schema.version).toBe(1)
    expect(schema.id.startsWith('form_')).toBe(true)
    expect(schema.name).toBe('未命名表单')
    expect(schema.description).toBe('')
    expect(schema.fields).toEqual([])
    expect(schema.settings).toEqual({ labelPosition: 'top', submitText: '提交' })
  })

  it('可以指定名字，且每次的 id 不同', () => {
    expect(createEmptySchema('报名表').name).toBe('报名表')
    expect(createEmptySchema().id).not.toBe(createEmptySchema().id)
  })
})

describe('normalizeSchema：拒绝不是表单的东西', () => {
  it.each([null, undefined, 42, 'x', [], [1, 2]])('%s 一律返回 null', input => {
    expect(normalizeSchema(input)).toBeNull()
  })

  it('version 不是 1 返回 null', () => {
    expect(normalizeSchema({ version: 2, fields: [] })).toBeNull()
    expect(normalizeSchema({ fields: [] })).toBeNull()
  })

  it('fields 不是数组返回 null', () => {
    expect(normalizeSchema({ version: 1, fields: 'x' })).toBeNull()
    expect(normalizeSchema({ version: 1 })).toBeNull()
  })
})

describe('normalizeSchema：补齐与收敛', () => {
  it('demoSchema 原样通过（导出再导入一致的前提）', () => {
    expect(normalizeSchema(demoSchema)).toEqual(demoSchema)
  })

  it('字段缺的键全部补齐', () => {
    const schema = normalizeSchema({ version: 1, fields: [{ type: 'text' }] })
    expect(schema).not.toBeNull()
    const field = schema?.fields[0]
    expect(field && field.id.length > 0).toBe(true)
    expect(field).toMatchObject({
      parentId: null,
      order: 0,
      type: 'text',
      name: 'text',
      label: '未命名字段',
      props: {},
      rules: [],
      visibleWhen: null,
    })
  })

  it('顶层缺的键也补齐，settings 用默认值合并', () => {
    const schema = normalizeSchema({ version: 1, fields: [], settings: { labelPosition: 'left' } })
    expect(schema).toMatchObject({
      version: 1,
      name: '未命名表单',
      description: '',
      settings: { labelPosition: 'left', submitText: '提交' },
    })
    expect(schema?.id.startsWith('form_')).toBe(true)
  })

  it('未知字段类型收敛成单行文本，而不是让渲染器抛异常', () => {
    const schema = normalizeSchema({ version: 1, fields: [{ id: 'a', type: '魔法字段' }] })
    expect(schema?.fields[0]?.type).toBe('text')
  })

  it('id 重复时给后来者换一个新 id', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'same', type: 'text', name: 'a' },
        { id: 'same', type: 'text', name: 'b' },
      ],
    })
    const [first, second] = schema?.fields ?? []
    expect(first?.id).toBe('same')
    expect(second?.id).not.toBe('same')
  })

  it('name 重复时给后来者换一个新 name（提交结果的键不能撞）', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'a', type: 'text', name: 'dup' },
        { id: 'b', type: 'text', name: 'dup' },
        { id: 'c', type: 'text', name: 'dup' },
      ],
    })
    expect(schema?.fields.map(f => f.name)).toEqual(['dup', 'dup1', 'dup2'])
  })

  it('parentId 指向不存在的字段时挂回根层', () => {
    const schema = normalizeSchema({ version: 1, fields: [{ id: 'a', type: 'text', name: 'a', parentId: 'ghost' }] })
    expect(schema?.fields[0]?.parentId).toBeNull()
  })

  it('parentId 指向自己时挂回根层', () => {
    const schema = normalizeSchema({ version: 1, fields: [{ id: 'a', type: 'text', name: 'a', parentId: 'a' }] })
    expect(schema?.fields[0]?.parentId).toBeNull()
  })

  it('父子成环时断开，不会让 buildTree 死循环', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'a', type: 'text', name: 'a', parentId: 'b' },
        { id: 'b', type: 'text', name: 'b', parentId: 'a' },
      ],
    })
    expect(schema).not.toBeNull()
    expect(schema?.fields.some(f => f.parentId === null)).toBe(true)
  })

  it('同级 order 重排成 0..n-1，保留原来的相对顺序', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'c', type: 'text', name: 'c', order: 9 },
        { id: 'a', type: 'text', name: 'a', order: 5 },
        { id: 'b', type: 'text', name: 'b', order: 5 },
      ],
    })
    expect(schema?.fields.map(f => f.order)).toEqual([0, 1, 2])
    expect(schema?.fields.map(f => f.name)).toEqual(['a', 'b', 'c'])
  })

  it('跨层级的 order 各算各的', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'g', type: 'group', name: 'g', order: 0 },
        { id: 'x', type: 'text', name: 'x', parentId: 'g', order: 7 },
        { id: 'y', type: 'text', name: 'y', parentId: 'g', order: 3 },
        { id: 'root', type: 'text', name: 'root', order: 4 },
      ],
    })
    expect(childrenOf(schema!.fields, 'g').map(f => f.name)).toEqual(['y', 'x'])
    expect(childrenOf(schema!.fields, 'g').map(f => f.order)).toEqual([0, 1])
    expect(childrenOf(schema!.fields, null).map(f => f.order)).toEqual([0, 1])
  })

  it('非法规则丢掉，合法规则保留（含自定义文案）', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        {
          id: 'a',
          type: 'text',
          name: 'a',
          rules: [
            { kind: 'required' },
            { kind: 'minLength', value: 3 },
            { kind: 'maxLength', value: '5' },
            { kind: 'pattern', value: '^\\d+$', message: '只许数字' },
            { kind: 'custom', name: 'email' },
            { kind: 'custom', name: '不存在' },
            { kind: '乱写' },
            null,
          ],
        },
      ],
    })
    expect(schema?.fields[0]?.rules).toEqual([
      { kind: 'required' },
      { kind: 'minLength', value: 3 },
      { kind: 'pattern', value: '^\\d+$', message: '只许数字' },
      { kind: 'custom', name: 'email' },
    ])
  })

  it('visibleWhen 非法则为 null，合法则保留 value', () => {
    const schema = normalizeSchema({
      version: 1,
      fields: [
        { id: 'a', type: 'text', name: 'a', visibleWhen: { field: 'b', op: 'eq', value: 'yes' } },
        { id: 'b', type: 'text', name: 'b', visibleWhen: { field: '', op: 'eq' } },
        { id: 'c', type: 'text', name: 'c', visibleWhen: { field: 'b', op: '乱写' } },
        { id: 'd', type: 'text', name: 'd', visibleWhen: 'x' },
      ],
    })
    expect(schema?.fields[0]?.visibleWhen).toEqual({ field: 'b', op: 'eq', value: 'yes' })
    expect(schema?.fields[1]?.visibleWhen).toBeNull()
    expect(schema?.fields[2]?.visibleWhen).toBeNull()
    expect(schema?.fields[3]?.visibleWhen).toBeNull()
  })

  it('props 是对象才保留（拷贝一份，不改原对象）', () => {
    const props = { placeholder: '请输入' }
    const schema = normalizeSchema({ version: 1, fields: [{ id: 'a', type: 'text', name: 'a', props }] })
    expect(schema?.fields[0]?.props).toEqual({ placeholder: '请输入' })
    expect(schema?.fields[0]?.props).not.toBe(props)
    expect(normalizeSchema({ version: 1, fields: [{ id: 'a', type: 'text', props: 'x' }] })?.fields[0]?.props).toEqual({})
  })

  it('fields 里混入非对象时跳过，不影响其它字段', () => {
    const schema = normalizeSchema({ version: 1, fields: [null, 1, { id: 'a', type: 'text', name: 'a' }] })
    expect(schema?.fields).toHaveLength(1)
  })
})

describe('parseSchemaJson：导入的三种结果', () => {
  it('合法表单', () => {
    const result = parseSchemaJson(toJsonText(demoSchema))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.schema).toEqual(demoSchema)
  })

  it('坏 JSON 给出人话错误', () => {
    expect(parseSchemaJson('{ 不是 json')).toEqual({ ok: false, error: '不是合法的 JSON 文件' })
  })

  it('JSON 合法但不是表单文件', () => {
    const result = parseSchemaJson(JSON.stringify({ version: 2, fields: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('不是有效的表单文件')
  })
})

describe('导出文本与文件名', () => {
  it('缩进 2 空格，能直接读', () => {
    const text = toJsonText(makeSchema([makeField({ id: 'a', type: 'text', name: 'a', label: 'A' })]))
    expect(text).toContain('\n  "version": 1')
    expect(text.endsWith('}')).toBe(true)
  })

  it('文件名用表单名，非法字符换成短横线', () => {
    expect(schemaFileName(makeSchema([]))).toBe('测试表单.json')
    expect(schemaFileName({ ...makeSchema([]), name: 'a/b:c*d?e"f<g>h|i j' })).toBe('a-b-c-d-e-f-g-h-i-j.json')
    expect(schemaFileName({ ...makeSchema([]), name: '   ' })).toBe('form.json')
  })
})

describe('M6 验收：导出再导入完全一致', () => {
  it('demoSchema 往返后逐字节相同', () => {
    const text = toJsonText(demoSchema)
    const result = parseSchemaJson(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schema).toEqual(demoSchema)
    expect(toJsonText(result.schema)).toBe(text)
  })

  it('手工改乱过的 JSON 导入后也是规范形态', () => {
    const messy = JSON.stringify({
      version: 1,
      name: '乱表单',
      fields: [
        { id: 'b', type: 'text', label: 'B', order: 4 },
        { id: 'a', type: '未知', name: 'a', order: 2, rules: [{ kind: 'required' }] },
      ],
      settings: {},
    })
    const result = parseSchemaJson(messy)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schema.fields.map(f => f.id)).toEqual(['a', 'b'])
    expect(result.schema.fields.map(f => f.order)).toEqual([0, 1])
    expect(result.schema.fields[0]?.type).toBe('text')
    expect(result.schema.settings).toEqual({ labelPosition: 'top', submitText: '提交' })
  })
})
