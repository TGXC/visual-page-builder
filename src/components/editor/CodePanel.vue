<script setup lang="ts">
/** 代码面板：HTML / CSS 页签、复制、下载 .html、新窗口预览 */
import { computed, ref } from 'vue'
import { exportFileName } from '@/core/codegen'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const toast = ref('')

/** CSS 页签：基础样式以内联方式落在每个元素上，这里只列断点覆盖（media query） */
const CSS_NOTE = '/* 基础样式以内联方式输出在每个元素上，这里只列出断点覆盖 */'

const code = computed(() => {
  if (store.codeTab !== 'css') return store.generatedHtml
  const responsive = store.generatedCss
  return responsive ? `${CSS_NOTE}\n\n${responsive}` : CSS_NOTE
})
const title = computed(() => store.activePage?.name ?? '页面')

function setTab(tab: 'html' | 'css'): void {
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
