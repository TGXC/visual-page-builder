<script setup lang="ts">
/** 多页面标签：切换 / 新增 / 删除 / 双击改名 */
import { nextTick, ref } from 'vue'
import type { PageId } from '@/core/schema/types'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const renamingId = ref<PageId | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename(id: PageId, name: string): Promise<void> {
  renamingId.value = id
  renameValue.value = name
  await nextTick()
  // v-for 里的 ref 收到的是数组，这里只可能有一个改名的输入框
  const raw = renameInput.value as unknown as HTMLInputElement | HTMLInputElement[] | null
  const input = Array.isArray(raw) ? raw[0] : raw
  input?.select?.()
}

function commitRename(): void {
  const id = renamingId.value
  renamingId.value = null
  if (id) store.renamePage(id, renameValue.value)
}
</script>

<template>
  <nav class="page-tabs">
    <div class="page-tabs__list">
      <div
        v-for="page in store.pages"
        :key="page.id"
        class="page-tab"
        :class="{ 'page-tab--active': page.id === store.activePage?.id }"
        :data-page-id="page.id"
        @click="store.switchPage(page.id)"
        @dblclick="startRename(page.id, page.name)"
      >
        <input
          v-if="renamingId === page.id"
          ref="renameInput"
          v-model="renameValue"
          class="page-tab__rename"
          data-role="page-rename"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc="renamingId = null"
          @blur="commitRename"
        >
        <span v-else class="page-tab__name">{{ page.name }}</span>
        <button
          v-if="store.pages.length > 1"
          type="button"
          class="page-tab__close icon-button"
          title="删除页面"
          @click.stop="store.removePage(page.id)"
        >
          ✕
        </button>
      </div>
    </div>
    <button type="button" class="page-tabs__add icon-button" data-role="add-page" title="新增页面" @click="store.addPage()">＋</button>
  </nav>
</template>
