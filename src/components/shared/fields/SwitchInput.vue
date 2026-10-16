<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    activeText?: string
    inactiveText?: string
    disabled?: boolean
  }>(),
  { activeText: '', inactiveText: '', disabled: false },
)

const emit = defineEmits<{ 'update:value': [value: boolean] }>()

/** 来自手写 JSON 的值可能是 1 / 'true'，这里统一成布尔再渲染 */
const on = computed(() => props.value === true || props.value === 1 || props.value === 'true' || props.value === '1')
</script>

<template>
  <label class="fb-switch">
    <input
      :id="id"
      class="fb-switch__control"
      type="checkbox"
      :checked="on"
      :disabled="disabled"
      @change="emit('update:value', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="on ? activeText : inactiveText" class="fb-switch__text">{{ on ? activeText : inactiveText }}</span>
  </label>
</template>
