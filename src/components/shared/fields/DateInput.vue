<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    min?: string
    max?: string
    disabled?: boolean
  }>(),
  { min: '', max: '', disabled: false },
)

const emit = defineEmits<{ 'update:value': [value: string] }>()

const text = computed(() => (props.value === undefined || props.value === null ? '' : String(props.value)))
</script>

<template>
  <input
    :id="id"
    class="fb-date__control"
    type="date"
    :value="text"
    :min="min || undefined"
    :max="max || undefined"
    :disabled="disabled"
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
