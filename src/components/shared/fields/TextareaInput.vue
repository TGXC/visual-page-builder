<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    placeholder?: string
    rows?: number
    maxlength?: number
    disabled?: boolean
  }>(),
  { placeholder: '', rows: 3, disabled: false },
)

const emit = defineEmits<{ 'update:value': [value: string] }>()

const text = computed(() => (props.value === undefined || props.value === null ? '' : String(props.value)))

function onInput(event: Event): void {
  emit('update:value', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <textarea
    :id="id"
    class="fb-textarea__control"
    :value="text"
    :rows="rows"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :disabled="disabled"
    @input="onInput"
  />
</template>
