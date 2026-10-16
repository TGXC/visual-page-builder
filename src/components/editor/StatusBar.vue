<script setup lang="ts">
/** 状态栏：实时坐标 / 选中尺寸 / 元素与页面计数 / 缩放 */
import { computed } from 'vue'
import { rectOf } from '@/core/geometry'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const box = computed(() => {
  const primary = store.primary
  if (!primary) return null
  const rect = rectOf(primary)
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
  }
})
const count = computed(() => Object.keys(store.nodes).length - 1)
</script>

<template>
  <footer class="status-bar">
    <span class="status-bar__item" data-role="pointer">{{ Math.round(store.pointer.x) }}, {{ Math.round(store.pointer.y) }}</span>
    <span v-if="box" class="status-bar__item status-bar__item--strong" data-role="selection-box">
      x {{ box.x }} · y {{ box.y }} · {{ box.w }} × {{ box.h }}
    </span>
    <span v-else class="status-bar__item status-bar__item--muted">未选中元素</span>
    <span class="status-bar__spacer" />
    <span class="status-bar__item">{{ count }} 个元素 · {{ store.pages.length }} 页</span>
    <span class="status-bar__item" data-role="zoom">{{ Math.round(store.zoom * 100) }}%</span>
  </footer>
</template>
