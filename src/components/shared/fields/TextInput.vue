<script setup lang="ts">
import { computed } from 'vue'

/**
 * 哑组件：只认 value + props，只 emit update:value。
 * 它不知道自己被编辑器还是运行时使用，也不知道字段规则。
 */
const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    placeholder?: string
    maxlength?: number
    clearable?: boolean
    disabled?: boolean
  }>(),
  { placeholder: '', clearable: false, disabled: false },
)

const emit = defineEmits<{ (e: 'update:value', value: string): void }>()

const text = computed(() => (props.value === null || props.value === undefined ? '' : String(props.value)))

function onInput(event: Event): void {
  emit('update:value', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="fb-input">
    <input
      :id="id"
      class="fb-input__control"
      type="text"
      :value="text"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      @input="onInput"
    />
    <button
      v-if="clearable && text !== ''"
      class="fb-input__clear"
      type="button"
      aria-label="清空"
      @click="emit('update:value', '')"
    >
      ×
    </button>
  </div>
</template>
