<script setup lang="ts">
/** 版本历史面板（M8 / 功能文档 L6）：带名字的快照，可回滚，回滚本身也能撤销 */
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const name = ref('')

function save(): void {
  if (store.saveCurrentVersion(name.value)) name.value = ''
}
</script>

<template>
  <section class="panel panel--versions">
    <h3 class="panel__title">
      版本历史
      <span class="panel__count" data-role="version-count">{{ store.versionsCount }}</span>
    </h3>

    <div class="ai-settings">
      <input v-model="name" class="editor-input" data-role="version-name" placeholder="版本名字（如：改版前）">
      <button type="button" class="editor-button" data-role="version-save" @click="save">保存当前版本</button>
    </div>

    <ul class="version-list">
      <li v-for="entry in store.versions" :key="entry.id" class="version-item" data-role="version-item">
        <span class="version-item__name">{{ entry.name }}</span>
        <span class="version-item__meta">{{ store.describeVersion(entry) }}</span>
        <button type="button" class="ai-link" data-role="version-restore" @click="store.restoreVersionById(entry.id)">回滚</button>
        <button type="button" class="ai-link" data-role="version-delete" @click="store.removeVersionById(entry.id)">删除</button>
      </li>
    </ul>
    <p v-if="store.versionsCount === 0" class="panel__empty">还没有保存过版本</p>
    <button
      v-if="store.versionsCount > 0"
      type="button"
      class="ai-link"
      data-role="version-clear"
      @click="store.clearAllVersions()"
    >
      清空全部版本
    </button>
  </section>
</template>
