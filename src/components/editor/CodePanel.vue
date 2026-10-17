<script setup lang="ts">
/** 代码面板：HTML / CSS / Vue 页签、复制、下载 .html、新窗口预览 */
import { computed, ref } from 'vue'
import { exportFileName } from '@/core/codegen'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const toast = ref('')

/** 三个页签分别是：单文件 HTML、独立样式表（M5 起是完整 CSS，不是只有媒体查询）、Vue 3 SFC */
const code = computed(() => {
  if (store.codeTab === 'css') return store.generatedCss
  if (store.codeTab === 'vue') return store.generatedVue
  return store.generatedHtml
})
const title = computed(() => store.activePage?.name ?? '页面')

function setTab(tab: 'html' | 'css' | 'vue'): void {
  store.codeTab = tab
}

async function copy(): Promise<void> {
  const text = code.value
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      toast.value = '已复制到剪贴板'
    } else {
      toast.value = '这个浏览器不支持自动复制，请手动选中代码'
    }
  } catch {
    toast.value = '复制失败，请手动选中代码'
  }
  window.setTimeout(() => (toast.value = ''), 2000)
}

function download(): void {
  const blob = new Blob(['\uFEFF', store.generatedHtml], { type: 'text/html;charset=utf-8' })
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportFileName(store.doc)
  anchor.click()
  URL.revokeObjectURL(url)
  store.pushToast('已下载 HTML 文件')
}

function openPreview(): void {
  const win = window.open('', '_blank')
  if (!win) {
    store.pushToast('浏览器拦截了新窗口', 'error')
    return
  }
  win.document.write(store.generatedHtml)
  win.document.close()
}
</script>

<template>
  <section class="panel panel--code">
    <div class="code-tabs">
      <button
        type="button"
        class="code-tab"
        :class="{ 'code-tab--active': store.codeTab === 'html' }"
        data-role="tab-html"
        @click="setTab('html')"
      >
        HTML
      </button>
      <button
        type="button"
        class="code-tab"
        :class="{ 'code-tab--active': store.codeTab === 'css' }"
        data-role="tab-css"
        @click="setTab('css')"
      >
        CSS
      </button>
      <button
        type="button"
        class="code-tab"
        :class="{ 'code-tab--active': store.codeTab === 'vue' }"
        data-role="tab-vue"
        @click="setTab('vue')"
      >
        Vue
      </button>
      <span class="code-tabs__spacer" />
      <button type="button" class="icon-button" data-role="copy-code" title="复制代码" @click="copy">⧉</button>
      <button type="button" class="icon-button" data-role="download-code" title="下载 HTML" @click="download">⭳</button>
      <button type="button" class="icon-button" data-role="preview-code" title="新窗口预览" @click="openPreview">↗</button>
    </div>
    <p class="code-caption" data-role="code-caption">{{ title }} · 共 {{ Object.keys(store.nodes).length - 1 }} 个元素</p>
    <pre class="code-view" data-role="code-view">{{ code }}</pre>
    <p v-if="toast" class="code-toast" data-role="code-toast">{{ toast }}</p>
  </section>
</template>
