<script setup lang="ts">
import { computed, ref } from 'vue'
import { createDoc, parseImportedDoc } from '@/core/schema'
import type { Doc, SceneNode, SizeSpec } from '@/core/schema'
import { childrenOf } from '@/core/tree'

const doc = ref<Doc | null>(null)
const draft = ref('')
const message = ref('')
const failed = ref(false)
const pageId = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const pages = computed(() => doc.value?.pages ?? [])

const activePage = computed(() => {
  const current = pageId.value ?? doc.value?.activePageId ?? null
  return pages.value.find((page) => page.id === current) ?? pages.value[0] ?? null
})

const elements = computed(() =>
  activePage.value ? childrenOf(activePage.value.nodes, activePage.value.root) : [],
)

const elementCount = computed(() =>
  pages.value.reduce((total, page) => total + Object.keys(page.nodes).length - 1, 0),
)

function sizeText(node: SceneNode): string {
  const part = (spec: SizeSpec): string => (spec.kind === 'fixed' ? String(spec.value ?? 0) : spec.kind)
  return `${part(node.layout.size.w)} × ${part(node.layout.size.h)}`
}

function positionText(node: SceneNode): string {
  return `${node.layout.position.x}, ${node.layout.position.y}`
}

function textOf(node: SceneNode): string {
  const text = node.props.text
  if (typeof text === 'string') return text
  return node.meta.name ?? ''
}

function selectPage(id: string): void {
  pageId.value = id
}

function pickFile(): void {
  fileInput.value?.click()
}

function newProject(): void {
  const created = createDoc('我的站点')
  doc.value = created
  pageId.value = created.activePageId
  failed.value = false
  message.value = `已新建项目「${created.name}」`
}

function applyText(text: string): void {
  const result = parseImportedDoc(text)
  if (!result.ok) {
    failed.value = true
    message.value = result.error
    return
  }
  doc.value = result.doc
  pageId.value = result.doc.activePageId
  failed.value = false
  const count = result.doc.pages.reduce((total, page) => total + Object.keys(page.nodes).length - 1, 0)
  message.value = result.migratedFromV1
    ? `已从 WebBuilder v1 迁移：${result.doc.pages.length} 页 / ${count} 个元素`
    : `已导入 v2 文档：${result.doc.pages.length} 页 / ${count} 个元素`
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  applyText(await file.text())
  input.value = ''
}
</script>

<template>
  <div class="studio-app">
    <header class="studio-bar">
      <span class="studio-bar__brand">Studio</span>
      <span class="studio-bar__tag">可视化页面搭建器 · M0 地基（v2 数据模型 + WebBuilder v1 迁移）</span>
      <div class="studio-bar__actions">
        <button class="studio-button studio-new" type="button" @click="newProject">新建项目</button>
        <button class="studio-button studio-button--primary" type="button" @click="pickFile">
          导入 JSON 文件
        </button>
        <input
          ref="fileInput"
          class="studio-import__file"
          type="file"
          accept="application/json,.json"
          @change="onFileChange"
        />
      </div>
    </header>

    <main class="studio-main">
      <section class="studio-panel">
        <h2 class="studio-panel__title">导入 / 粘贴</h2>
        <textarea
          v-model="draft"
          class="studio-textarea"
          placeholder="在这里粘贴 WebBuilder 导出的 JSON，或从 localStorage 复制的存档…"
        ></textarea>
        <p class="studio-counts">
          支持两种输入：WebBuilder v1 导出文件（自动迁移）与 Studio v2 文档。
        </p>
        <button class="studio-button studio-button--primary studio-import__apply" type="button" @click="applyText(draft)">
          导入这段 JSON
        </button>
        <p v-if="message" class="studio-message" :class="{ 'studio-message--error': failed }">{{ message }}</p>
      </section>

      <section class="studio-panel">
        <h2 class="studio-panel__title">当前文档</h2>
        <div v-if="!doc" class="studio-empty">
          还没有载入文档：点右上角「新建项目」，或粘贴 / 导入一份 WebBuilder 项目 JSON。
        </div>
        <template v-else>
          <p class="studio-project__name">{{ doc.name }}</p>
          <div class="studio-counts">
            <span>页面 <strong>{{ pages.length }}</strong></span>
            <span>元素 <strong>{{ elementCount }}</strong></span>
            <span>版本 <strong>v{{ doc.version }}</strong></span>
          </div>
          <div class="studio-pages">
            <button
              v-for="page in pages"
              :key="page.id"
              class="studio-page-tab"
              :class="{ 'studio-page-tab--active': activePage?.id === page.id }"
              type="button"
              :data-page-id="page.id"
              @click="selectPage(page.id)"
            >
              {{ page.name }}
            </button>
          </div>
          <p v-if="elements.length === 0" class="studio-empty">这个页面还没有元素。</p>
          <div v-else class="studio-list">
            <div v-for="node in elements" :key="node.id" class="studio-node-row" :data-node-id="node.id">
              <span class="studio-node-row__id">{{ node.id }}</span>
              <span class="studio-node-row__type">{{ node.type }}</span>
              <span class="studio-node-row__text">{{ textOf(node) }}</span>
              <span class="studio-node-row__pos">{{ positionText(node) }}</span>
              <span class="studio-node-row__size">{{ sizeText(node) }}</span>
            </div>
          </div>
        </template>
      </section>
    </main>
  </div>
</template>
