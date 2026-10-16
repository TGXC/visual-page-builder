<script setup lang="ts">
/**
 * 编辑器外壳：顶栏 + 左（组件/图层）+ 中（页面标签/画布/状态栏）+ 右（属性/代码）
 * 以及全局快捷键、右键菜单、toast。与 store 的接线只在这里。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { exportFileName } from '@/core/codegen'
import { drawPage } from '@/core/export'
import { useEditorStore } from '@/stores/editor'
import CanvasStage from '@/components/canvas/CanvasStage.vue'
import CodePanel from './CodePanel.vue'
import ContextMenu from './ContextMenu.vue'
import LayerPanel from './LayerPanel.vue'
import PageTabs from './PageTabs.vue'
import PalettePanel from './PalettePanel.vue'
import PropPanel from './PropPanel.vue'
import StatusBar from './StatusBar.vue'

const store = useEditorStore()
const menu = ref<{ x: number; y: number } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const stageWidth = ref(1200)

const viewportLabel = computed(() => store.viewport().label)

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (mod && !event.altKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (key === 'y') {
      event.preventDefault()
      store.redo()
      return
    }
    if (key === 'a') {
      event.preventDefault()
      store.selectMany(store.topLevel.map((node) => node.id))
      return
    }
    if (key === 'd') {
      event.preventDefault()
      store.duplicateSelection()
      return
    }
    if (key === 'c') {
      if (isTyping(event.target) && !store.selectedIds.length) return
      store.copySelection()
      return
    }
    if (key === 'v') {
      if (isTyping(event.target)) return
      store.pasteClipboard()
      return
    }
    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      store.zoomBy(0.25)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      store.zoomBy(-0.25)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      store.setZoom(1)
      return
    }
  }
  if (isTyping(event.target)) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    store.removeSelection()
    return
  }
  if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    store.nudge(dx, dy)
    return
  }
  if (event.key === 'Escape') {
    store.clearSelection()
    menu.value = null
  }
}

function onWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  store.zoomBy(event.deltaY > 0 ? -0.25 : 0.25)
}

function onViewportWidth(event: Event): void {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  // 空值/非数字：忽略（NaN 会被 store 挡掉），并把输入框恢复成当前宽度。
  if (raw !== '') store.setViewportWidth(Number(raw))
  input.value = String(store.viewport().w)
}

function onExportJson(): void {
  const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' })
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportFileName(store.doc, 'json')
  anchor.click()
  URL.revokeObjectURL(url)
  store.pushToast('已导出项目 JSON')
}

function onExportPng(): void {
  const canvas = document.createElement('canvas')
  const size = store.viewport()
  canvas.width = size.w
  canvas.height = size.h
  const context = canvas.getContext('2d')
  if (!context) {
    store.pushToast('当前环境不支持导出 PNG', 'error')
    return
  }
  const ok = drawPage(context as never, store.doc, store.activePage?.id ?? '', {})
  if (!ok) {
    store.pushToast('这一页没有内容', 'error')
    return
  }
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = exportFileName(store.doc, 'png')
  anchor.click()
  store.pushToast('已导出 PNG 截图')
}

async function onFileChange(event: Event): Promise<void> {  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  store.importText(text)
  input.value = ''
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('wheel', onWheel, { passive: false })
  stageWidth.value = window.innerWidth || 1200
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <div class="editor">
    <header class="editor-bar">
      <div class="editor-bar__brand">
        <span class="editor-bar__logo">Studio</span>
        <span class="editor-bar__doc" data-role="doc-name">{{ store.doc.name }}</span>
      </div>

      <div class="editor-bar__group">
        <button type="button" class="editor-button" data-role="undo" :disabled="!store.canUndo" title="撤销 (Ctrl+Z)" @click="store.undo()">↺</button>
        <button type="button" class="editor-button" data-role="redo" :disabled="!store.canRedo" title="重做 (Ctrl+Shift+Z)" @click="store.redo()">↻</button>
        <span class="editor-bar__history" data-role="history-position">{{ store.position }}</span>
      </div>

      <div class="editor-bar__group">
        <button
          v-for="id in ['desktop', 'tablet', 'mobile']"
          :key="id"
          type="button"
          class="editor-button"
          :class="{ 'editor-button--active': store.breakpointId === id }"
          :data-role="`viewport-${id}`"
          @click="store.setBreakpoint(id)"
        >
          {{ id === 'desktop' ? '桌面' : id === 'tablet' ? '平板' : '手机' }}
        </button>
        <input
          class="editor-input editor-input--width"
          type="number"
          min="200"
          max="10000"
          step="1"
          data-role="viewport-width"
          :value="store.viewport().w"
          @change="onViewportWidth"
        >
        <span class="editor-bar__viewport" data-role="viewport-label">{{ viewportLabel }}</span>
      </div>

      <div class="editor-bar__group">
        <button type="button" class="editor-button" data-role="zoom-out" @click="store.zoomBy(-0.25)">－</button>
        <button type="button" class="editor-button" data-role="zoom-reset" @click="store.setZoom(1)">100%</button>
        <button type="button" class="editor-button" data-role="zoom-in" @click="store.zoomBy(0.25)">＋</button>
        <button type="button" class="editor-button" data-role="zoom-fit" @click="store.fitZoom(stageWidth)">适应</button>
      </div>

      <div class="editor-bar__group editor-bar__group--right">
        <button type="button" class="editor-button" data-role="new-project" @click="store.newProject()">新建</button>
        <button type="button" class="editor-button" data-role="import-json" @click="fileInput?.click()">导入</button>
        <button type="button" class="editor-button" data-role="export-json" @click="onExportJson">导出</button>
        <button type="button" class="editor-button" data-role="export-png" @click="onExportPng">PNG</button>
        <input ref="fileInput" class="editor-bar__file" type="file" accept="application/json,.json" data-role="import-file" @change="onFileChange">
      </div>
    </header>

    <div class="editor-main">
      <aside class="editor-side editor-side--left">
        <PalettePanel />
        <LayerPanel />
      </aside>

      <section class="editor-center">
        <PageTabs />
        <CanvasStage @context-menu="menu = $event" />
        <StatusBar />
      </section>

      <aside class="editor-side editor-side--right">
        <PropPanel />
        <CodePanel />
      </aside>
    </div>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" @close="menu = null" />

    <div class="toast-stack">
      <p v-for="toast in store.toasts" :key="toast.id" class="toast" :class="`toast--${toast.kind}`" data-role="toast">
        {{ toast.text }}
      </p>
    </div>
  </div>
</template>
