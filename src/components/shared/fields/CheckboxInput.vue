<script setup lang="ts">
import { computed } from 'vue'
import type { SelectOption } from '@/fields/registry'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    options?: SelectOption[]
    inline?: boolean
    disabled?: boolean
  }>(),
  { options: () => [], inline: false, disabled: false },
)

const emit = defineEmits<{ 'update:value': [value: Array<string | number>] }>()

/** 值不是数组时当作「一个都没勾」：手写的 JSON 里出现字符串也不至于崩 */
const checked = computed<Array<string | number>>(() => (Array.isArray(props.value) ? props.value : []))

function isChecked(value: string | number): boolean {
  return checked.value.some(item => String(item) === String(value))
}

/** 结果按选项顺序排列，不受点击顺序影响：提交上来的数组更稳定、更好比对 */
function onChange(value: string | number, on: boolean): void {
  const next = new Set(checked.value.map(item => String(item)))
  if (on) next.add(String(value))
  else next.delete(String(value))
  emit(
    'update:value',
    props.options.filter(option => next.has(String(option.value))).map(option => option.value),
  )
}
</script>

<template>
  <div class="fb-checkbox" :class="{ 'fb-checkbox--inline': inline }">
    <label v-for="option in options" :key="String(option.value)" class="fb-checkbox__item">
      <input
        class="fb-checkbox__control"
        type="checkbox"
        :value="option.value"
        :checked="isChecked(option.value)"
        :disabled="disabled"
        @change="onChange(option.value, ($event.target as HTMLInputElement).checked)"
      />
      <span class="fb-checkbox__label">{{ option.label }}</span>
    </label>
  </div>
</template>
