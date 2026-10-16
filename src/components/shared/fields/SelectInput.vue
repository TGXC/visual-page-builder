<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    placeholder?: string
    options?: Array<{ label: string; value: string | number }>
    clearable?: boolean
    disabled?: boolean
  }>(),
  { placeholder: '', options: () => [], clearable: false, disabled: false },
)

const emit = defineEmits<{ (e: 'update:value', value: string | number | null): void }>()

const text = computed(() =>
  props.value === null || props.value === undefined || props.value === '' ? '' : String(props.value),
)

const list = computed(() => props.options ?? [])

function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === '') {
    emit('update:value', null)
    return
  }
  const hit = list.value.find(option => String(option.value) === raw)
  emit('update:value', hit ? hit.value : raw)
}
</script>

<template>
  <select :id="id" class="fb-select__control" :value="text" :disabled="disabled" @change="onChange">
    <option value="">{{ placeholder || '请选择' }}</option>
    <option v-for="option in list" :key="String(option.value)" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>
