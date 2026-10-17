<script setup lang="ts">
/** 分享 / 发布面板（M8 / 功能文档 L6）：生成 `#doc=` 链接、从链接载入、静态托管说明 */
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const incoming = ref('')

function open(): void {
  if (store.openSharedDoc(incoming.value)) incoming.value = ''
}
</script>

<template>
  <section class="panel panel--share">
    <h3 class="panel__title">分享 / 发布</h3>

    <label class="ai-field">
      <span class="ai-field__label">分享链接（整份文档编码在 # 后面）</span>
      <input
        class="editor-input"
        data-role="share-link"
        readonly
        :value="store.shareTooLong ? '文档太大，地址栏放不下，请用顶栏「整站」导出' : store.shareLink"
      >
    </label>
    <button type="button" class="editor-button" data-role="share-copy" @click="store.copyShareLink()">
      复制分享链接
    </button>

    <label class="ai-field">
      <span class="ai-field__label">从分享链接载入</span>
      <input v-model="incoming" class="editor-input" data-role="share-open-input" placeholder="粘贴 #doc=… 或完整地址">
    </label>
    <button type="button" class="editor-button" data-role="share-open" @click="open">载入链接里的文档</button>
    <p class="panel__hint">
      链接只包含文档本身，不会上传到任何服务器；发布请把那串链接或顶栏导出的 zip 放到静态托管上。
    </p>
  </section>
</template>
