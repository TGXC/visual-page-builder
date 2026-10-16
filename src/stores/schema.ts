import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createId } from '@/core/id'
import { buildTree, nextOrder } from '@/core/tree'
import { getDescriptor } from '@/fields'
import { PERSIST_DELAY, saveSchema } from './persist'
import { useHistoryStore } from './history'
import type { FieldNode, FieldType, FormSchema, MutableFieldKey, Patch } from '@/core/types'

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

const MUTABLE_KEYS: MutableFieldKey[] = ['name', 'label', 'props', 'rules', 'visibleWhen']

const KEY_LABELS: Record<MutableFieldKey, string> = {
  name: '字段名',
  label: '标签',
  props: '属性',
  rules: '校验规则',
  visibleWhen: '显示条件',
}

export const useSchemaStore = defineStore('schema', () => {
  // 当前 schema 住在 history store 里：撤销/重做/跳转都在改那一份，这里只是读它
  const history = useHistoryStore()
  const schema = computed(() => history.base)

  const selectedIds = ref<string[]>([])

  const fieldById = computed(() => new Map(schema.value.fields.map(field => [field.id, field])))
  const selectedId = computed(() => selectedIds.value[0] ?? null)
  const selectedField = computed(() => (selectedId.value ? (fieldById.value.get(selectedId.value) ?? null) : null))
  const tree = computed(() => buildTree(schema.value.fields))

  // 自动保存：所有变更都落到 history.base 上，所以监听一处就够。
  // `persisting` 为 false 时（分享页加载别人的 schema）只读不写，别覆盖访客的草稿。
  let persisting = true
  let timer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave(): void {
    if (!persisting) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveSchema(schema.value)
    }, PERSIST_DELAY)
  }
  watch(schema, () => scheduleSave(), { deep: true })

  // 撤销/删除之后选中的字段可能已经不存在了。sync 让调用方不用等 nextTick 就能断言。
  watch(
    schema,
    next => {
      if (selectedIds.value.length === 0) return
      const alive = new Set(next.fields.map(field => field.id))
      selectedIds.value = selectedIds.value.filter(id => alive.has(id))
    },
    { flush: 'sync' },
  )

  /** 结构性变更的唯一出口：记一条历史 + 把补丁贴上 */
  function commit(label: string, patch: Patch, mergeKey?: string): void {
    history.commit({ label, patch, mergeKey, at: Date.now() })
  }

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
    commit(`新增${descriptor.label}`, { op: 'insert', field })
    select(id)
    return id
  }

  function removeField(id: string): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return
    commit(`删除${field.label}`, { op: 'remove', field })
  }

  /** 只允许改 MutableFieldKey：id/parentId/order 走各自的专用动作。 */
  function updateField(id: string, after: Partial<Pick<FieldNode, MutableFieldKey>>): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return

    const before: Partial<Pick<FieldNode, MutableFieldKey>> = {}
    const next: Partial<Pick<FieldNode, MutableFieldKey>> = {}
    const keys: MutableFieldKey[] = []

    for (const key of MUTABLE_KEYS) {
      if (!(key in after)) continue
      keys.push(key)
      // props/rules 整体替换，并且深拷贝：历史里的补丁不能跟着外部对象一起被改
      if (key === 'props') {
        before.props = clone(field.props)
        next.props = clone(after.props ?? {})
      } else if (key === 'rules') {
        before.rules = clone(field.rules)
        next.rules = clone(after.rules ?? [])
      } else if (key === 'visibleWhen') {
        before.visibleWhen = field.visibleWhen
        next.visibleWhen = after.visibleWhen ?? null
      } else if (key === 'name') {
        before.name = field.name
        next.name = after.name ?? field.name
      } else {
        before.label = field.label
        next.label = after.label ?? field.label
      }
    }
    if (keys.length === 0) return

    commit(
      `修改${keys.map(key => KEY_LABELS[key]).join('、')}`,
      { op: 'update', id, before, after: next },
      `update:${id}:${[...keys].sort().join(',')}`,
    )
  }

  function moveField(id: string, parentId: string | null, order: number): void {
    const field = schema.value.fields.find(item => item.id === id)
    if (!field) return
    // 幂等：原地放下不产生新 schema，否则历史里会多一条什么都没变的记录
    if (field.parentId === parentId && field.order === order) return

    commit('移动字段', {
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
    commit(`复制${source.label}`, { op: 'insert', field: copy })
    select(copyId)
    return copyId
  }

  /**
   * 导入 JSON / 新建表单：换一条时间线。
   * `persist: false` 用在分享页——打开别人的链接不该覆盖访客自己的草稿（D21）。
   */
  function setSchema(next: FormSchema, options: { persist?: boolean } = {}): void {
    persisting = options.persist ?? true
    history.reset(next)
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
