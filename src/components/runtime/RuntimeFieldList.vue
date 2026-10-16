<script setup lang="ts">
import FieldControl from '@/components/shared/FieldControl.vue'
import FieldRuntime from './FieldRuntime.vue'
import { getDescriptor } from '@/fields/registry'
import type { FieldTreeNode } from '@/core/tree'
import type { ErrorMap, FormValues } from '@/core/types'

/**
 * 运行态的递归渲染：可见树进、控件出。
 * 容器（group）用注册表里的容器组件包住子字段，叶子交给 FieldRuntime，
 * 所以编辑态与运行态复用的是同一批哑组件。
 * 组件按文件名自引用（RuntimeFieldList），因此分组可以无限套。
 */
withDefaults(
  defineProps<{
    nodes: FieldTreeNode[]
    values?: FormValues
    errors?: ErrorMap
  }>(),
  { values: () => ({}), errors: () => ({}) },
)

const emit = defineEmits<{ 'update:value': [name: string, value: unknown] }>()

function isContainer(node: FieldTreeNode): boolean {
  return getDescriptor(node.field.type).isContainer === true
}
</script>

<template>
  <template v-for="node in nodes" :key="node.field.id">
    <section v-if="isContainer(node)" class="fb-group-field" :data-field-id="node.field.id">
      <span class="fb-field__label">{{ node.field.label }}</span>
      <FieldControl :field="node.field">
        <RuntimeFieldList
          :nodes="node.children"
          :values="values"
          :errors="errors"
          @update:value="(name, value) => emit('update:value', name, value)"
        />
      </FieldControl>
    </section>
    <FieldRuntime
      v-else
      :field="node.field"
      :value="values[node.field.name]"
      :errors="errors[node.field.name] ?? []"
      @update:value="emit('update:value', node.field.name, $event)"
    />
  </template>
</template>
