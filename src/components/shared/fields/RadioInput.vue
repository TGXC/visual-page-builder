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

const emit = defineEmits<{ 'update:value': [value: string | number] }>()

const current = computed(() => (props.value === undefined || props.value === null ? '' : String(props.value)))

function isChecked(value: string | number): boolean {
  return String(value) === current.value
}

function onChange(value: string | number): void {
  emit('update:value', value)
}
</script>

<template>
  <div class="fb-radio" :class="{ 'fb-radio--inline': inline }">
    <label v-for="option in options" :key="String(option.value)" class="fb-radio__item">
      <input
        class="fb-radio__control"
        type="radio"
        :name="id"
        :value="option.value"
        :checked="isChecked(option.value)"
        :disabled="disabled"
        @change="onChange(option.value)"
      />
      <span class="fb-radio__label">{{ option.label }}</span>
    </label>
  </div>
</template>
