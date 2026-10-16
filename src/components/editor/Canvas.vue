<script setup lang="ts">
import FieldList from './FieldList.vue'
import type { FieldNode, FormSchema } from '@/core/types'

/**
 * 编辑态画布：只把 schema 渲染出来，不绑值、不校验。
 * 选中/拖拽/工具条在 FieldWrapper 里，落点指示线由 FieldList 的 dropIndex 决定。
 */
defineProps<{
  schema: FormSchema
  fields?: FieldNode[]
  selectedIds?: string[]
  draggingId?: string | null
  /** 正在拖拽（过了阈值）时才显示指示线 */
  active?: boolean
  /** 指示线画在哪一层（跨容器拖拽时目标层可能不是根层） */
  dropParentId?: string | null
  dropIndex?: number | null
}>()

const emit = defineEmits<{
  select: [id: string]
  dragField: [id: string, event: PointerEvent]
  duplicate: [id: string]
  remove: [id: string]
}>()
</script>

<template>
  <div class="fb-canvas">
    <div class="fb-canvas__page">
      <h1 class="fb-canvas__title">{{ schema.name }}</h1>
      <p v-if="schema.description" class="fb-canvas__desc">{{ schema.description }}</p>

      <div v-if="(fields ?? schema.fields).length === 0" class="fb-empty">暂无字段</div>
      <div v-else class="fb-canvas__fields">
        <FieldList
          :fields="fields ?? schema.fields"
          :parent-id="null"
          :selected-ids="selectedIds"
          :dragging-id="draggingId"
          :active="active"
          :drop-parent-id="dropParentId"
          :drop-index="dropIndex"
          @select="emit('select', $event)"
          @drag-field="(id, event) => emit('dragField', id, event)"
          @duplicate="emit('duplicate', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>
  </div>
</template>
