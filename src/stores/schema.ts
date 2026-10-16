import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createId } from '@/core/id'
import { applyPatch } from '@/core/patch'
import { buildTree, nextOrder } from '@/core/tree'
import { getDescriptor } from '@/fields'
import { demoSchema } from '@/data/demoSchema'
import { PERSIST_DELAY, loadSchema, saveSchema } from './persist'
import type { FieldNode, FieldType, FormSchema, MutableFieldKey } from '@/core/types'

/**
 * props/rules 走 JSON 深拷贝。
 * 这不是偷懒：schema 必须能 JSON.stringify（分享链接与导出都依赖这一点），
 * 所以 props 里本来就不允许放函数，JSON 深拷贝与它的约束是一致的。
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneField(field: FieldNode): FieldNode {
  return { ...field, props: clone(field.props), rules: clone(field.rules) }
}

function cloneSchema(schema: FormSchema): FormSchema {
  return { ...schema, fields: schema.fields.map(cloneField), settings: { ...schema.settings } }
}

export const useSchemaStore = defineStore('schema', () => {
  // 冷启动：有存档用存档，否则用示例 schema（深拷贝，别让编辑器改到模块常量）
  const schema = ref<FormSchema>(cloneSchema(loadSchema() ?? demoSchema))
  const selectedIds = ref<string[]>([])

  const fieldById = computed(() => new Map(schema.value.fields.map(field => [field.id, field])))
  const selectedId = computed(() => selectedIds.value[0] ?? null)
  const selectedField = computed(() => (selectedId.value ? (fieldById.value.get(selectedId.value) ?? null) : null))
  const tree = computed(() => buildTree(schema.value.fields))

  // 自动保存：所有变更都收敛到 `schema.value = ...`，所以监听一处就够
  let timer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave(): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveSchema(schema.value)
    }, PERSIST_DELAY)
  }
  watch(schema, () => scheduleSave(), { deep: true })

  /** 字段名自动去重：拖十个单行文本也不会出现两个 name */
  function uniqueName(type: FieldType): string {
    const taken = new Set(schema.value.fields.map(field => field.name))
    let index = 1
    while (taken.has(`${type}${index}`)) index += 1
    return `${type}${index}`
  }

  function select(id: string | null): void {
    selectedIds.value = id === null ? [] : [id]
  }

  /** `at` 省略时追加到末尾；给数字就插到同级的第 at 位。 */
  function addField(type: FieldType, parentId: string | null = null, at?: number): string {
    const descriptor = getDescriptor(type)
    const id = createId()
    const field: FieldNode = {
      id,
      parentId,
      order: at ?? nextOrder(schema.value.fields, parentId),
      type,
      name: uniqueName(type),
      label: descriptor.label,
      props: clone(descriptor.defaultProps),
      rules: clone(descriptor.defaultRules ?? []),
      visibleWhen: null,
    }
    schema.value = applyPatch(schema.value, { op: 'insert', field })
    select(id)
    return id
  }

  function removeField(id: string): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return
    schema.value = applyPatch(schema.value, { op: 'remove', field })
    selectedIds.value = selectedIds.value.filter(selected => selected !== id)
  }

  /** 只允许改 MutableFieldKey：id/parentId/order 走各自的专用动作。 */
  function updateField(id: string, after: Partial<Pick<FieldNode, MutableFieldKey>>): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return

    const before: Partial<Pick<FieldNode, MutableFieldKey>> = {}
    if ('name' in after) before.name = field.name
    if ('label' in after) before.label = field.label
    if ('props' in after) before.props = field.props
    if ('rules' in after) before.rules = field.rules
    if ('visibleWhen' in after) before.visibleWhen = field.visibleWhen

    schema.value = applyPatch(schema.value, { op: 'update', id, before, after })
  }

  function moveField(id: string, parentId: string | null, order: number): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return
    // 幂等：原地放下不产生新 schema，否则历史里会多一条什么都没变的记录
    if (field.parentId === parentId && field.order === order) return

    schema.value = applyPatch(schema.value, {
      op: 'move',
      id,
      before: { parentId: field.parentId, order: field.order },
      after: { parentId, order },
    })
  }

  function duplicateField(id: string): string | null {
    const source = schema.value.fields.find(item => item.id === id)
    if (!source) return null

    const copyId = createId()
    const copy: FieldNode = {
      ...cloneField(source),
      id: copyId,
      name: uniqueName(source.type),
      order: source.order + 1,
    }
    schema.value = applyPatch(schema.value, { op: 'insert', field: copy })
    select(copyId)
    return copyId
  }

  function setSchema(next: FormSchema): void {
    schema.value = cloneSchema(next)
    selectedIds.value = []
  }

  return {
    schema,
    selectedIds,
    selectedId,
    selectedField,
    fieldById,
    tree,
    select,
    addField,
    removeField,
    updateField,
    moveField,
    duplicateField,
    setSchema,
  }
})
