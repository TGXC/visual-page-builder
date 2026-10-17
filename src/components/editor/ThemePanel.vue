<script setup lang="ts">
/** 主题 token 面板（M8 / 功能文档 L7）：改一个 token，所有引用它的元素一起变色 */
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const name = ref('')
const value = ref('')

function add(): void {
  if (store.writeThemeToken(name.value, value.value)) {
    name.value = ''
    value.value = ''
  }
}

function edit(tokenName: string, next: string): void {
  store.writeThemeToken(tokenName, next)
}
</script>

<template>
  <section class="panel panel--theme">
    <h3 class="panel__title">
      主题 token
      <span class="panel__count" data-role="theme-count">{{ store.themeTokens.length }}</span>
    </h3>

    <p v-if="store.themeMissing.length > 0" class="panel__hint theme-missing" data-role="theme-missing">
      有 {{ store.themeMissing.length }} 个引用没定义：{{ store.themeMissing.join('、') }}
    </p>

    <ul class="theme-tokens">
      <li v-for="token in store.themeTokens" :key="token.name" class="theme-token" data-role="theme-token">
        <span class="theme-token__name" :title="token.group.label">{{ token.name }}</span>
        <input
          class="editor-input theme-token__value"
          data-role="theme-token-value"
          :value="token.value"
          @change="edit(token.name, ($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="ai-link"
          data-role="theme-token-delete"
          title="删除这个 token"
          @click="store.deleteThemeToken(token.name)"
        >
          删除
        </button>
      </li>
    </ul>
    <p v-if="store.themeTokens.length === 0" class="panel__empty">还没有 token</p>

    <div class="ai-settings">
      <input
        v-model="name"
        class="editor-input"
        data-role="theme-token-name"
        placeholder="color-primary"
      >
      <input
        v-model="value"
        class="editor-input"
        data-role="theme-token-new-value"
        placeholder="#2563EB"
      >
      <button type="button" class="editor-button" data-role="theme-token-add" @click="add">添加 / 修改</button>
    </div>
    <p class="panel__hint">样式里写 <code>$color-primary</code>，导出时自动变成 <code>var(--color-primary)</code>。</p>
  </section>
</template>
