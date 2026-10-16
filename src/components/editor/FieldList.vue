<script setup lang="ts">
import { computed } from 'vue'
import DropIndicator from './DropIndicator.vue'
import FieldWrapper from './FieldWrapper.vue'
import { childrenOf } from '@/core/tree'
import type { FieldNode } from '@/core/types'

/**
 * 某一层字段（同一个 parentId 下的兄弟）的渲染：指示线 + 字段外壳。
 * 组件自己递归自己，所以 group 能无限套下去，画布与 group 内部用的是同一个组件。
 */
const props = withDefaults(
  defineProps<{
    fields: FieldNode[]
    parentId: string | null
    selectedIds?: string[]
    draggingId?: string | null
    /** 正在拖拽（过了阈值）时才显示指示线 */
    active?: boolean
    dropParentId?: string | null
    dropIndex?: number | null
  }>(),
  { selectedIds: () => [], draggingId: null, active: false, dropParentId: null, dropIndex: null },
)

const emit = defineEmits<{
  select: [id: string]
  dragField: [id: string, event: PointerEvent]
  duplicate: [id: string]
  remove: [id: string]
}>()

const siblings = computed(() => childrenOf(props.fields, props.parentId))
const selectedSet = computed(() => new Set(props.selectedIds))

function isSelected(field: FieldNode): boolean {
  return selectedSet.value.has(field.id)
}

/** 指示线只在「当前拖拽的目标层」显示，别的层保持安静 */
function indicatorActive(index: number): boolean {
  return Boolean(props.active) && props.dropParentId === props.parentId && props.dropIndex === index
}
</script>

<template>
  <div class="fb-field-list" :data-parent-id="parentId ?? ''">
    <template v-for="(field, index) in siblings" :key="field.id">
      <DropIndicator :active="indicatorActive(index)" />
      <FieldWrapper
        :field="field"
        :fields="fields"
        :selected="isSelected(field)"
        :dragging="draggingId === field.id"
        :selected-ids="selectedIds"
        :dragging-id="draggingId"
        :active="active"
        :drop-parent-id="dropParentId"
        :drop-index="dropIndex"
        @select="emit('select', $event)"
        @drag-start="emit('dragField', field.id, $event)"
        @duplicate="emit('duplicate', $event)"
        @remove="emit('remove', $event)"
      />
    </template>
    <DropIndicator :active="indicatorActive(siblings.length)" />
  </div>
</template>
