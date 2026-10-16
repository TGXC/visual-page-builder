<script setup lang="ts">
import { computed } from 'vue'
import '@/fields'
import { getDescriptor } from '@/fields/registry'
import type { FieldNode } from '@/core/types'

/**
 * 两条渲染路径共用的宿主：把「字段配置」翻译成「控件属性」。
 * 编辑器与运行时都只经过这里，所以字段控件的行为永远一致。
 */
const props = defineProps<{ field: FieldNode; value?: unknown }>()

const emit = defineEmits<{ (e: 'update:value', value: unknown): void }>()

const descriptor = computed(() => getDescriptor(props.field.type))

/** 默认属性打底 + 字段自己的属性：旧 schema 少写一个键也不会渲染出 undefined */
const controlProps = computed(() => ({ ...descriptor.value.defaultProps, ...props.field.props }))
</script>

<template>
  <component
    :is="descriptor.component"
    :id="field.id"
    v-bind="controlProps"
    :value="value"
    @update:value="emit('update:value', $event)"
  >
    <!-- 容器字段（group）把子字段接进默认插槽，两条渲染路径都靠这一条 -->
    <slot />
  </component>
</template>
