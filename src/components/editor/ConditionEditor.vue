<script setup lang="ts">
import { computed } from 'vue'
import type { Condition, ConditionOp, FieldNode } from '@/core/types'

/**
 * 显示条件编辑器：哑组件。
 * 条件只能是 `{field, op, value}` 三个字段的数据（不能放函数），这样才能随 schema 一起 JSON 序列化。
 */
const props = defineProps<{ field: FieldNode; fields: FieldNode[] }>()

const emit = defineEmits<{ (e: 'update:visibleWhen', condition: Condition | null): void }>()

const OPS: Array<{ op: ConditionOp; label: string }> = [
  { op: 'eq', label: '等于' },
  { op: 'neq', label: '不等于' },
  { op: 'in', label: '属于' },
  { op: 'gt', label: '大于' },
  { op: 'lt', label: '小于' },
  { op: 'truthy', label: '有值' },
]

const condition = computed<Condition | null>(() => props.field.visibleWhen)

/** 依赖的候选字段：不能依赖自己，分组容器也没有值可依赖 */
const candidates = computed(() => props.fields.filter(f => f.id !== props.field.id && f.type !== 'group'))

const needsValue = computed(() => condition.value !== null && condition.value.op !== 'truthy')

const valueText = computed(() => {
  const value = condition.value?.value
  return value === undefined || value === null ? '' : String(value)
})

function toggle(event: Event): void {
  if (!(event.target as HTMLInputElement).checked) {
    emit('update:visibleWhen', null)
    return
  }
  const first = candidates.value[0]
  // 没有可依赖的字段时不写条件，界面上给提示
  if (!first) return
  emit('update:visibleWhen', { field: first.name, op: 'eq' })
}

function setField(event: Event): void {
  const current = condition.value
  if (!current) return
  emit('update:visibleWhen', { ...current, field: (event.target as HTMLSelectElement).value })
}

function setOp(event: Event): void {
  const current = condition.value
  if (!current) return
  const op = (event.target as HTMLSelectElement).value as ConditionOp
  emit('update:visibleWhen', { ...current, op, value: op === 'truthy' ? undefined : current.value })
}

function setValue(event: Event): void {
  const current = condition.value
  if (!current) return
  emit('update:visibleWhen', { ...current, value: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <fieldset class="fb-condition">
    <legend class="fb-condition__legend">显示条件</legend>

    <label class="fb-condition__row">
      <input class="fb-condition__toggle" type="checkbox" :checked="condition !== null" @change="toggle" />
      <span>只在满足条件时显示</span>
    </label>

    <p v-if="candidates.length === 0" class="fb-condition__hint">先添加另一个字段，才能设置显示条件</p>

    <div v-else-if="condition" class="fb-condition__body">
      <select class="fb-condition__field" :value="condition.field" @change="setField">
        <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.name">
          {{ candidate.label }}
        </option>
      </select>

      <select class="fb-condition__op" :value="condition.op" @change="setOp">
        <option v-for="item in OPS" :key="item.op" :value="item.op">{{ item.label }}</option>
      </select>

      <input
        v-if="needsValue"
        class="fb-condition__value"
        :value="valueText"
        placeholder="比较的值"
        @input="setValue"
      />

      <button type="button" class="fb-condition__clear" @click="emit('update:visibleWhen', null)">清除条件</button>
    </div>
  </fieldset>
</template>
