import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useSchemaStore } from './schema'
import { validateField, visibleFields } from '@/core/validation'
import { getDescriptor } from '@/fields/registry'
import '@/fields'
import type { ErrorMap, FieldNode, FormValues } from '@/core/types'

/**
 * 运行态：用户填的值、校验出来的错误、以及提交结果。
 * 它只认 schema store 里的字段列表，自己不持有 schema —— 编辑器改了字段，预览页立刻跟着变。
 * 隐藏字段的值会被保留在 `values` 里（用户可能只是暂时切走了条件），但**不进提交结果**（D16）。
 */
export const useRuntimeStore = defineStore('runtime', () => {
  const schema = useSchemaStore()

  const values = ref<FormValues>({})
  const errors = ref<ErrorMap>({})
  const submitted = ref<FormValues | null>(null)

  /** 当前真正参与填写的字段（分组的显隐会连带子孙） */
  const visible = computed<FieldNode[]>(() => visibleFields(schema.schema, values.value))

  /** 按可见顺序第一个出错的字段名，滚动定位就靠它 */
  const firstErrorName = computed<string | null>(() => {
    for (const field of visible.value) {
      if (errors.value[field.name]) return field.name
    }
    return null
  })

  function setValue(name: string, value: unknown): void {
    values.value = { ...values.value, [name]: value }
    // 一改就把这条错误清掉，不必等下一次校验；别的字段的错误留着
    if (errors.value[name]) {
      const next: ErrorMap = { ...errors.value }
      delete next[name]
      errors.value = next
    }
  }

  /** 全表单校验，返回是否通过；错误表每次都重建，隐藏字段的旧错误会自然消失 */
  function validate(): boolean {
    const next: ErrorMap = {}
    for (const field of visible.value) {
      const messages = validateField(field, values.value[field.name])
      if (messages.length > 0) next[field.name] = messages
    }
    errors.value = next
    return Object.keys(next).length === 0
  }

  /** 校验通过就返回要提交的 FormValues（只有可见、且真的产出值的字段），否则返回 null */
  function submit(): FormValues | null {
    submitted.value = null
    if (!validate()) return null
    const payload: FormValues = {}
    for (const field of visible.value) {
      // 分隔线这类「不产出值」的字段不该出现在提交结果里
      if (getDescriptor(field.type).hasValue === false) continue
      payload[field.name] = values.value[field.name]
    }
    submitted.value = payload
    return payload
  }

  function reset(): void {
    values.value = {}
    errors.value = {}
    submitted.value = null
  }

  return { values, errors, submitted, visible, firstErrorName, setValue, validate, submit, reset }
})
