<script setup lang="ts">
import { computed } from 'vue'
import DropIndicator from './DropIndicator.vue'
import FieldWrapper from './FieldWrapper.vue'
import { childrenOf } from '@/core/tree'
import type { FieldNode, FormSchema } from '@/core/types'

/**
 * 编辑态画布：只把 schema 渲染出来，不绑值、不校验。
 * 选中/拖拽/工具条在 FieldWrapper 里，落点指示线由这里的 dropIndex 决定。
 */
const props = defineProps<{
  schema: FormSchema
  selectedIds?: string[]
  draggingId?: string | null
  /** 正在拖拽（过了阈值）时才显示指示线 */
  active?: boolean
  dropIndex?: number | null
}>()

const emit = defineEmits<{
  select: [id: string]
  dragField: [id: string, event: PointerEvent]
  duplicate: [id: string]
  remove: [id: string]
}>()

const fields = computed(() => childrenOf(props.schema.fields, null))
const selectedSet = computed(() => new Set(props.selectedIds ?? []))

function isSelected(field: FieldNode): boolean {
  return selectedSet.value.has(field.id)
}

function indicatorActive(index: number): boolean {
  return Boolean(props.active) && props.dropIndex === index
}
</script>

<template>
  <div class="fb-canvas">
    <div class="fb-canvas__page">
      <h1 class="fb-canvas__title">{{ schema.name }}</h1>
      <p v-if="schema.description" class="fb-canvas__desc">{{ schema.description }}</p>

      <div v-if="fields.length === 0" class="fb-empty">暂无字段</div>
      <div v-else class="fb-canvas__fields">
        <template v-for="(field, index) in fields" :key="field.id">
          <DropIndicator :active="indicatorActive(index)" />
          <FieldWrapper
            :field="field"
            :selected="isSelected(field)"
            :dragging="draggingId === field.id"
            @select="emit('select', $event)"
            @drag-start="emit('dragField', field.id, $event)"
            @duplicate="emit('duplicate', $event)"
            @remove="emit('remove', $event)"
          />
        </template>
        <DropIndicator :active="indicatorActive(fields.length)" />
      </div>
    </div>
  </div>
</template>
