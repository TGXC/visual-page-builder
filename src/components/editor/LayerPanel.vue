<script setup lang="ts">
/** 图层面板：树形结构、选中、双击改名、显隐、锁定、上下移层 */
import { computed, nextTick, ref } from 'vue'
import type { NodeId } from '@/core/schema/types'
import { treeOf } from '@/core/tree'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()

interface Row {
  id: NodeId
  label: string
  type: string
  depth: number
  hidden: boolean
  locked: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (forest: ReturnType<typeof treeOf>, depth: number): void => {
    for (const item of forest) {
      out.push({
        id: item.node.id,
        label: item.node.meta.name ?? item.node.type,
        type: item.node.type,
        depth,
        hidden: item.node.meta.hidden,
        locked: item.node.meta.locked,
      })
      walk(item.children, depth + 1)
    }
  }
  walk(treeOf(store.nodes, store.rootId), 0)
  return out
})

const renamingId = ref<NodeId | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename(row: Row): Promise<void> {
  renamingId.value = row.id
  renameValue.value = row.label
  await nextTick()
  // v-for 里的 ref 收到的是数组，这里只可能有一个改名的输入框
  const raw = renameInput.value as unknown as HTMLInputElement | HTMLInputElement[] | null
  const input = Array.isArray(raw) ? raw[0] : raw
  input?.select?.()
}

function commitRename(): void {
  const id = renamingId.value
  if (!id) return
  const node = store.nodes[id]
  renamingId.value = null
  if (!node) return
  store.updateNode(id, { meta: { ...node.meta, name: renameValue.value.trim() || undefined } }, `rename:${id}`)
}

function toggle(id: NodeId, key: 'hidden' | 'locked'): void {
  const node = store.nodes[id]
  if (!node) return
  store.updateNode(id, { meta: { ...node.meta, [key]: !node.meta[key] } })
}

function isDisabled(row: Row): boolean {
  return row.hidden
}
</script>

<template>
  <section class="panel panel--layers">
    <h2 class="panel__title">图层</h2>
    <p v-if="rows.length === 0" class="panel__empty">画布还是空的</p>
    <ul v-else class="layer-list">
      <li
        v-for="row in rows"
        :key="row.id"
        class="layer-row"
        :class="{
          'layer-row--selected': store.selectedIds.includes(row.id),
          'layer-row--hidden': row.hidden,
        }"
        :data-layer-id="row.id"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
        @click="store.select(row.id)"
        @dblclick="startRename(row)"
      >
        <span class="layer-row__type">{{ row.type }}</span>
        <input
          v-if="renamingId === row.id"
          ref="renameInput"
          v-model="renameValue"
          class="layer-row__rename"
          data-role="layer-rename"
          @keydown.enter.prevent="commitRename"
          @keydown.esc="renamingId = null"
          @blur="commitRename"
        >
        <span v-else class="layer-row__label">{{ row.label }}</span>
        <span class="layer-row__actions">
          <button type="button" class="icon-button" :title="row.hidden ? '显示' : '隐藏'" @click.stop="toggle(row.id, 'hidden')">
            {{ row.hidden ? '◌' : '◉' }}
          </button>
          <button type="button" class="icon-button" :title="row.locked ? '解锁' : '锁定'" @click.stop="toggle(row.id, 'locked')">
            {{ row.locked ? '🔒' : '🔓' }}
          </button>
          <button type="button" class="icon-button" title="上移一层" :disabled="isDisabled(row)" @click.stop="store.layer(row.id, 'up')">↑</button>
          <button type="button" class="icon-button" title="下移一层" :disabled="isDisabled(row)" @click.stop="store.layer(row.id, 'down')">↓</button>
        </span>
      </li>
    </ul>
  </section>
</template>
