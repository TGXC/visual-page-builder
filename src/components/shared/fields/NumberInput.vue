<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    placeholder?: string
    min?: number
    max?: number
    step?: number
    disabled?: boolean
  }>(),
  { placeholder: '', disabled: false },
)

const emit = defineEmits<{ (e: 'update:value', value: number | null): void }>()

/** 空字符串必须是 null，不能是 0：否则「没填」和「填了 0」分不出来。 */
const text = computed(() =>
  props.value === null || props.value === undefined || props.value === '' ? '' : String(props.value),
)

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update:value', raw === '' ? null : Number(raw))
}
</script>

<template>
  <input
    :id="id"
    class="fb-input__control"
    type="number"
    :value="text"
    :placeholder="placeholder"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    @input="onInput"
  />
</template>
