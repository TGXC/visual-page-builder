<script setup lang="ts">
import FieldControl from '@/components/shared/FieldControl.vue'
import type { FieldNode } from '@/core/types'

/**
 * 运行时的单个字段：值绑在 runtime.values 上，错误由父级传进来。
 * 和编辑器的 FieldWrapper 长得很像，但两者目的不同：这里只负责填值和显示错误。
 */
defineProps<{ field: FieldNode; value?: unknown; errors?: string[] }>()

const emit = defineEmits<{ (e: 'update:value', value: unknown): void }>()
</script>

<template>
  <div class="fb-field" :class="{ 'fb-field--error': (errors?.length ?? 0) > 0 }" :data-name="field.name">
    <label class="fb-field__label" :for="field.id">{{ field.label }}</label>
    <FieldControl :field="field" :value="value" @update:value="emit('update:value', $event)" />
    <p v-for="message in errors ?? []" :key="message" class="fb-field__error">{{ message }}</p>
  </div>
</template>
