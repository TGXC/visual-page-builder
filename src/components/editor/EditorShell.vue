<script setup lang="ts">
/**
 * 编辑器外壳：顶栏 + 左（组件/图层）+ 中（页面标签/画布/状态栏）+ 右（属性/代码）
 * 以及全局快捷键、右键菜单、toast。与 store 的接线只在这里。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { exportFileName } from '@/core/codegen'
import { drawPage } from '@/core/export'
import { createZip } from '@/core/zip'
import { VIEWPORTS, useEditorStore } from '@/stores/editor'
import CanvasStage from '@/components/canvas/CanvasStage.vue'
import AiPanel from './AiPanel.vue'
import CodePanel from './CodePanel.vue'
import ContextMenu from './ContextMenu.vue'
import LayerPanel from './LayerPanel.vue'
import PageTabs from './PageTabs.vue'
import PalettePanel from './PalettePanel.vue'
import PropPanel from './PropPanel.vue'
import LayoutPanel from './LayoutPanel.vue'
import SharePanel from './SharePanel.vue'
import StatusBar from './StatusBar.vue'
import ThemePanel from './ThemePanel.vue'
import VersionPanel from './VersionPanel.vue'

const store = useEditorStore()
const menu = ref<{ x: number; y: number } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const stageWidth = ref(1200)

/** 右侧栏改成页签：原来七块面板竖着堆，滚动条长得看不到底（M9 反馈的画布外排版问题） */
type SideTab = 'props' | 'layout' | 'theme' | 'ai' | 'versions' | 'share' | 'code'
const sideTabs: { id: SideTab; label: string }[] = [
  { id: 'props', label: '属性' },
  { id: 'layout', label: '布局' },
  { id: 'theme', label: '主题' },
  { id: 'ai', label: 'AI' },
  { id: 'versions', label: '历史' },
  { id: 'share', label: '分享' },
  { id: 'code', label: '代码' },
]
const sideTab = ref<SideTab>('props')

const viewportLabel = computed(() => {
  const { w, h } = store.viewport()
  return `${w} × ${h}`
})
/** 三个预设用「名字 + 1440 × 900」两行展示：只说「桌面 1440」看不出高度 */
const viewportPresets = computed(() =>
  (['desktop', 'tablet', 'mobile'] as const).map((id) => ({ id, ...VIEWPORTS[id] })),
)

/** 缩放输入框显示的百分比。用 `适应` 算出来的非整档比例（如 113%）也要如实显示 */
const zoomPercent = computed(() => Math.round(store.zoom * 100))

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
  if (event.altKey && event.key.startsWith('Arrow')) {
    // M8 / E8：键盘也能换选中项（Alt + 方向键在整棵树里前后走）
    event.preventDefault()
    store.selectNext(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
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
    // 有选中就退一层（父分区），再按一次才清空 —— 深层容器里不用再去点面包屑
    if (store.selectedIds.length > 0) store.selectParent()
    else store.clearSelection()
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

function onViewportHeight(event: Event): void {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  if (raw !== '') store.setViewportHeight(Number(raw))
  input.value = String(store.viewport().h)
}

function onZoomInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  // 空值/非数字：忽略（store 里 NaN 会被挡掉），并把输入框恢复成当前百分比。
  if (raw !== '') store.setZoom(Number(raw) / 100)
  input.value = String(zoomPercent.value)
}

function onZoomKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  ;(event.target as HTMLInputElement).blur()
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

function onExportSite(): void {
  const files = store.siteFiles()
  if (files.length === 0) {
    store.pushToast('这一页没有内容', 'error')
    return
  }
  const zip = createZip(files)
  const blob = new Blob([zip], { type: 'application/zip' })
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportFileName(store.doc, 'zip')
  anchor.click()
  URL.revokeObjectURL(url)
  store.pushToast(`已导出整站（${files.length} 个文件）`)
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
  // 带 `#doc=` 的分享链接：打开就把文档载入（可撤销）
  store.loadSharedFromLocation()
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
        <button
          type="button"
          class="editor-button editor-button--danger"
          data-role="toolbar-delete"
          :disabled="!store.canRemoveSelection"
          :title="store.canRemoveSelection ? '删除选中元素 (Delete)' : '当前选中的是页面画布本身或锁定元素，删不掉'"
          @click="store.removeSelection()"
        >
          🗑 删除
        </button>
      </div>

      <div class="editor-bar__group editor-bar__group--viewport">
        <button
          v-for="preset in viewportPresets"
          :key="preset.id"
          type="button"
          class="editor-button editor-button--preset"
          :class="{ 'editor-button--active': store.breakpointId === preset.id }"
          :data-role="`viewport-${preset.id}`"
          :title="`${preset.label}：${preset.w} × ${preset.h}`"
          @click="store.setBreakpoint(preset.id)"
        >
          <span class="editor-button__label">{{ preset.label }}</span>
          <span class="editor-button__meta">{{ preset.w }} × {{ preset.h }}</span>
        </button>
        <input
          class="editor-input editor-input--width"
          type="number"
          min="200"
          max="10000"
          step="1"
          data-role="viewport-width"
          title="页面宽度（200–10000）"
          :value="store.viewport().w"
          @change="onViewportWidth"
        >
        <span class="editor-bar__times">×</span>
        <input
          class="editor-input editor-input--width"
          type="number"
          min="200"
          max="10000"
          step="1"
          data-role="viewport-height"
          title="页面高度（200–10000）"
          :value="store.viewport().h"
          @change="onViewportHeight"
        >
        <span class="editor-bar__viewport" data-role="viewport-label">{{ viewportLabel }}</span>
      </div>

      <div class="editor-bar__group">
        <button
          type="button"
          class="editor-button"
          data-role="zoom-out"
          title="缩小 25%（范围 25%–200%）"
          @click="store.zoomBy(-0.25)"
        >
          －
        </button>
        <span class="editor-bar__zoom">
          <input
            class="editor-input editor-input--zoom"
            data-role="zoom-input"
            type="number"
            min="25"
            max="200"
            step="1"
            inputmode="numeric"
            title="画布缩放 25%–200%：可直接输入百分比，回车或失焦生效"
            :value="zoomPercent"
            @change="onZoomInput"
            @keydown="onZoomKeydown"
          >
          <span class="editor-bar__unit">%</span>
        </span>
        <button
          type="button"
          class="editor-button"
          data-role="zoom-in"
          title="放大 25%（范围 25%–200%）"
          @click="store.zoomBy(0.25)"
        >
          ＋
        </button>
        <button type="button" class="editor-button" data-role="zoom-fit" title="缩放到适合窗口宽度" @click="store.fitZoom(stageWidth)">适应</button>
      </div>

      <div class="editor-bar__group editor-bar__group--right">
        <button
          type="button"
          class="editor-button"
          data-role="toolbar-clear"
          :disabled="!store.canClearPage"
          title="清空当前页面的全部元素（可撤销 Ctrl+Z）"
          @click="store.clearPage()"
        >
          清空
        </button>
        <button type="button" class="editor-button" data-role="new-project" @click="store.newProject()">新建</button>
        <button type="button" class="editor-button" data-role="import-json" @click="fileInput?.click()">导入</button>
        <button type="button" class="editor-button" data-role="export-json" @click="onExportJson">导出</button>
        <button type="button" class="editor-button" data-role="export-png" @click="onExportPng">PNG</button>
        <button type="button" class="editor-button" data-role="export-site" @click="onExportSite">整站</button>
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
        <nav class="side-tabs">
          <button
            v-for="tab in sideTabs"
            :key="tab.id"
            type="button"
            class="side-tab"
            :class="{ 'is-active': sideTab === tab.id }"
            :data-role="`side-tab-${tab.id}`"
            @click="sideTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </nav>
        <div class="side-body">
          <!-- 全部 v-show 保持挂载：面板里有 AI 候选、代码预览这些状态，切页签不该丢 -->
          <PropPanel v-show="sideTab === 'props'" />
          <LayoutPanel v-show="sideTab === 'layout'" />
          <ThemePanel v-show="sideTab === 'theme'" />
          <AiPanel v-show="sideTab === 'ai'" />
          <VersionPanel v-show="sideTab === 'versions'" />
          <SharePanel v-show="sideTab === 'share'" />
          <CodePanel v-show="sideTab === 'code'" />
        </div>
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
