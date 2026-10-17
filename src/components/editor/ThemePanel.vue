<script setup lang="ts">
/** 主题 token 面板（M8 / 功能文档 L7）：改一个 token，所有引用它的元素一起变色 */
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { tokenLabel } from '@/core/theme'

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
      主题变量
      <span class="panel__count" data-role="theme-count">{{ store.themeTokens.length }}</span>
    </h3>

    <p v-if="store.themeMissing.length > 0" class="panel__hint theme-missing" data-role="theme-missing">
      有 {{ store.themeMissing.length }} 个引用没定义：{{ store.themeMissing.join('、') }}
    </p>

    <ul class="theme-tokens">
      <li v-for="token in store.themeTokens" :key="token.name" class="theme-token" data-role="theme-token">
        <span class="theme-token__meta">
          <span class="theme-token__name" data-role="theme-token-label">{{ tokenLabel(token.name) }}</span>
          <code class="theme-token__raw" :title="`样式里用 $${token.name} 引用`">{{ token.name }}</code>
        </span>
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
          title="删除这个变量"
          @click="store.deleteThemeToken(token.name)"
        >
          删除
        </button>
      </li>
    </ul>
    <p v-if="store.themeTokens.length === 0" class="panel__empty">还没有变量</p>

    <div class="ai-settings">
      <input
        v-model="name"
        class="editor-input"
        data-role="theme-token-name"
        placeholder="变量名（英文，如 color-brand）"
      >
      <input
        v-model="value"
        class="editor-input"
        data-role="theme-token-new-value"
        placeholder="值（如 #2563EB 或 16）"
      >
      <button type="button" class="editor-button" data-role="theme-token-add" @click="add">添加 / 修改</button>
    </div>
    <p class="panel__hint">
      上面灰色小字是变量的英文名，样式里写成 <code>$color-primary</code>，导出时自动变成
      <code>var(--color-primary)</code>。
    </p>
  </section>
</template>
