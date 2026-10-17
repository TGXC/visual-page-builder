<script setup lang="ts">
/** 右键菜单：复制/粘贴/删除/置顶置底/格式刷/复制样式 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const store = useEditorStore()

interface MenuItem {
  key: string
  label: string
  disabled?: boolean
  /** 置灰原因写进 title，术语不进菜单文案：菜单里永远有一项叫「删除」 */
  title?: string
  run: () => void
}

const items = computed<MenuItem[]>(() => {
  const hasSelection = store.selectedIds.length > 0
  // 根节点与锁定元素不参与删除：菜单上直接置灰，比点了没反应好（M9/M11 反馈的「删不掉」）
  const deletable = store.selectedIds.filter((id) => id !== store.rootId && !store.nodes[id]?.meta.locked)
  const lockedOnly = hasSelection && deletable.length === 0
  const hasRoot = store.selectedIds.includes(store.rootId)
  const deleteTitle = !hasSelection
    ? '先选中要删除的元素'
    : lockedOnly
      ? hasRoot
        ? '这是页面画布本身（根容器），删不掉'
        : '元素已锁定，先解锁再删除'
      : '删除选中的元素 (Delete)'
  return [
    { key: 'copy', label: '复制', disabled: !hasSelection, run: () => store.copySelection() },
    { key: 'paste', label: '粘贴', disabled: !store.clipboard, run: () => store.pasteClipboard() },
    { key: 'duplicate', label: '创建副本', disabled: !hasSelection, run: () => store.duplicateSelection() },
    { key: 'front', label: '置顶', disabled: !hasSelection, run: () => layerAll('front') },
    { key: 'back', label: '置底', disabled: !hasSelection, run: () => layerAll('back') },
    { key: 'copy-style', label: '复制样式', disabled: !hasSelection, run: () => copyStyle() },
    { key: 'paste-style', label: '粘贴样式', disabled: !hasSelection || !store.styleClipboard, run: () => store.pasteStyleToSelection() },
    {
      key: 'delete',
      label: '删除',
      title: deleteTitle,
      disabled: !store.canRemoveSelection,
      run: () => store.removeSelection(),
    },
  ]
})

const copyStyle = (): void => {
  const primary = store.primary
  if (primary) store.copyStyleFrom(primary.id)
}

function layerAll(direction: 'front' | 'back'): void {
  for (const id of store.selectedIds) store.layer(id, direction)
}

function onClick(item: MenuItem): void {
  if (item.disabled) return
  item.run()
  emit('close')
}

function onWindowPointerDown(): void {
  emit('close')
}

onMounted(() => window.addEventListener('pointerdown', onWindowPointerDown))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onWindowPointerDown))
</script>

<template>
  <div
    class="context-menu"
    data-role="context-menu"
    :style="{ left: `${props.x}px`, top: `${props.y}px` }"
    @pointerdown.stop
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="context-menu__item"
      :class="{ 'context-menu__item--disabled': item.disabled }"
      :data-action="item.key"
      :title="item.title"
      :disabled="item.disabled"
      @click="onClick(item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
