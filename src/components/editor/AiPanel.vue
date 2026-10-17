<script setup lang="ts">
/**
 * AI 面板（M6）：供应商切换 + 一句话生成页面 + 选区指令 + 规则检查/一键修复 + 调用记录。
 * M7 追加：文案候选 / 素材候选 / 生成自定义组件（受限 DSL + 预览 + 注册）+ 成本与降级显示。
 * 面板只调用 store 暴露的 AI 动作；所有落库与历史都在 store 里完成。
 */
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { TextTone } from '@/ai/text'

const store = useEditorStore()
const pagePrompt = ref('')
const instruction = ref('')
const showSettings = ref(false)
const showLogs = ref(false)
const apiKey = ref(store.aiSettings.apiKey)
const baseUrl = ref(store.aiSettings.baseUrl)
const model = ref(store.aiSettings.model)
const textPrompt = ref('')
const textTone = ref<TextTone>('plain')
const materialPrompt = ref('')
const componentPrompt = ref('')

const issueCount = computed(() => store.aiIssues.length)
const fixableCount = computed(() => store.aiIssues.filter((issue) => issue.patches.length > 0).length)
const selectionLabel = computed(() =>
  store.selection.length === 0 ? '未选中元素' : `已选中 ${store.selection.length} 个元素`,
)
const usageLabel = computed(
  () =>
    `${store.aiUsage.calls} 次调用 · ${store.aiUsage.tokens.toLocaleString('en-US')} tokens · $${store.aiUsage.costUsd.toFixed(4)} · ${store.aiUsage.model}`,
)

function onProvider(event: Event): void {
  store.aiSetProvider((event.target as HTMLSelectElement).value)
}

function saveSettings(): void {
  store.aiSaveSettings({ apiKey: apiKey.value, baseUrl: baseUrl.value, model: model.value })
  store.pushToast('AI 设置已保存在本机浏览器')
}

async function generate(): Promise<void> {
  if (await store.aiGeneratePage(pagePrompt.value)) pagePrompt.value = ''
}

async function edit(): Promise<void> {
  if (await store.aiEditSelection(instruction.value)) instruction.value = ''
}

async function generateText(): Promise<void> {
  await store.aiTextOptions(textPrompt.value, textTone.value)
}

async function generateMaterial(): Promise<void> {
  await store.aiMaterialOptions(materialPrompt.value)
}

async function generateComponent(): Promise<void> {
  await store.aiComponentOption(componentPrompt.value)
}

function onTone(event: Event): void {
  textTone.value = (event.target as HTMLSelectElement).value as TextTone
}

function applyMaterial(index: number): void {
  store.aiApplyMaterial(index, materialPrompt.value)
}

function registerComponent(): void {
  if (store.aiRegisterComponent()) componentPrompt.value = ''
}
</script>

<template>
  <section class="panel panel--ai">
    <p class="panel__title">
      AI 助手
      <span class="panel__count" data-role="ai-issue-count">{{ issueCount }}</span>
    </p>

    <label class="ai-field">
      <span class="ai-field__label">供应商</span>
      <select class="editor-input" data-role="ai-provider" :value="store.aiProviderId" @change="onProvider">
        <option v-for="item in store.aiProviders" :key="item.id" :value="item.id" :disabled="!item.ready">
          {{ item.label }}{{ item.ready ? '' : '（未配置）' }}
        </option>
      </select>
    </label>
    <button type="button" class="ai-link" data-role="ai-settings-toggle" @click="showSettings = !showSettings">
      {{ showSettings ? '收起设置' : '接口设置（key 只存本机）' }}
    </button>
    <div v-if="showSettings" class="ai-settings">
      <input v-model="apiKey" class="editor-input" type="password" placeholder="API Key" data-role="ai-key">
      <input v-model="baseUrl" class="editor-input" type="text" placeholder="Base URL" data-role="ai-base-url">
      <input v-model="model" class="editor-input" type="text" placeholder="模型名" data-role="ai-model">
      <button type="button" class="editor-button" data-role="ai-settings-save" @click="saveSettings">保存</button>
    </div>

    <p v-if="store.aiDegraded" class="ai-message" data-role="ai-degraded">{{ store.aiDegraded }}</p>

    <p class="panel__title panel__title--spaced">一句话生成页面</p>
    <textarea
      v-model="pagePrompt"
      class="editor-input ai-textarea"
      rows="2"
      placeholder="例如：做一个读书会落地页"
      data-role="ai-page-prompt"
    />
    <button type="button" class="editor-button" data-role="ai-generate" :disabled="store.aiBusy" @click="generate">
      {{ store.aiBusy ? '生成中…' : '生成新页面' }}
    </button>

    <p class="panel__title panel__title--spaced">选区指令</p>
    <p class="panel__hint" data-role="ai-selection">{{ selectionLabel }}</p>
    <textarea
      v-model="instruction"
      class="editor-input ai-textarea"
      rows="2"
      placeholder="例如：把文案改成「立即预约」"
      data-role="ai-instruction"
    />
    <button
      type="button"
      class="editor-button"
      data-role="ai-edit"
      :disabled="store.aiBusy || store.selection.length === 0"
      @click="edit"
    >
      应用到选区
    </button>

    <p class="panel__title panel__title--spaced">文案候选（AI4）</p>
    <label class="ai-field">
      <span class="ai-field__label">语气</span>
      <select class="editor-input" data-role="ai-text-tone" :value="textTone" @change="onTone">
        <option value="plain">平实</option>
        <option value="warm">温和</option>
        <option value="bold">有力</option>
      </select>
    </label>
    <textarea
      v-model="textPrompt"
      class="editor-input ai-textarea"
      rows="2"
      placeholder="例如：读书会报名标题"
      data-role="ai-text-prompt"
    />
    <button type="button" class="editor-button" data-role="ai-text-generate" :disabled="store.aiBusy" @click="generateText">
      生成文案候选
    </button>
    <ul v-if="store.aiTextCandidates.length > 0" class="ai-candidates">
      <li v-for="(candidate, index) in store.aiTextCandidates" :key="candidate.id">
        <button
          type="button"
          class="ai-link ai-link--inline"
          data-role="ai-text-candidate"
          @click="store.aiApplyText(index)"
        >
          {{ candidate.text }}
        </button>
      </li>
    </ul>

    <p class="panel__title panel__title--spaced">素材候选（AI4）</p>
    <textarea
      v-model="materialPrompt"
      class="editor-input ai-textarea"
      rows="2"
      placeholder="例如：夏日读书会配图"
      data-role="ai-material-prompt"
    />
    <button
      type="button"
      class="editor-button"
      data-role="ai-material-generate"
      :disabled="store.aiBusy"
      @click="generateMaterial"
    >
      生成配图
    </button>
    <ul v-if="store.aiMaterialCandidates.length > 0" class="ai-materials">
      <li v-for="(candidate, index) in store.aiMaterialCandidates" :key="candidate.id">
        <button type="button" class="ai-material" data-role="ai-material" @click="applyMaterial(index)">
          <img class="ai-material__image" :src="candidate.dataUrl" :alt="candidate.label">
          <span class="ai-material__label">{{ candidate.label }}</span>
        </button>
      </li>
    </ul>

    <p class="panel__title panel__title--spaced">生成组件（受限 DSL，AI5）</p>
    <textarea
      v-model="componentPrompt"
      class="editor-input ai-textarea"
      rows="2"
      placeholder="例如：一个带头像和在线状态点的团队成员卡片"
      data-role="ai-component-prompt"
    />
    <button
      type="button"
      class="editor-button"
      data-role="ai-component-generate"
      :disabled="store.aiBusy"
      @click="generateComponent"
    >
      生成组件
    </button>
    <template v-if="store.aiComponentCandidate">
      <iframe
        class="ai-preview"
        data-role="ai-component-preview"
        sandbox=""
        title="组件预览"
        :srcdoc="store.aiComponentCandidate.previewHtml"
      />
      <button type="button" class="editor-button" data-role="ai-component-register" @click="registerComponent">
        注册到「我的组件」
      </button>
    </template>
    <p v-if="store.aiCustomTypes.length > 0" class="panel__hint" data-role="ai-custom-types">
      我的组件：{{ store.aiCustomTypes.length }} 个
    </p>

    <p class="panel__title panel__title--spaced">
      设计检查
      <button
        type="button"
        class="ai-link ai-link--inline"
        data-role="ai-fix-all"
        :disabled="fixableCount === 0"
        @click="store.aiFixAll()"
      >
        一键修复（{{ fixableCount }}）
      </button>
    </p>
    <p v-if="issueCount === 0" class="panel__empty" data-role="ai-clean">没有发现问题</p>
    <ul v-else class="ai-issues">
      <li v-for="issue in store.aiIssues" :key="issue.id" class="ai-issue" data-role="ai-issue">
        <span class="ai-issue__text" :class="`ai-issue--${issue.severity}`">{{ issue.message }}</span>
        <button
          type="button"
          class="ai-link ai-link--inline"
          :disabled="issue.patches.length === 0"
          data-role="ai-issue-fix"
          @click="store.aiFixIssue(issue.id)"
        >
          修复
        </button>
      </li>
    </ul>

    <p v-if="store.aiMessage" class="ai-message" data-role="ai-message">{{ store.aiMessage }}</p>

    <p class="panel__hint ai-usage" data-role="ai-usage">{{ usageLabel }}</p>
    <button type="button" class="ai-link" data-role="ai-logs-toggle" @click="showLogs = !showLogs">
      {{ showLogs ? '收起调用记录' : `调用记录（${store.aiLogs.length}）` }}
    </button>
    <div v-if="showLogs" class="ai-logs">
      <button type="button" class="ai-link ai-link--inline" data-role="ai-logs-clear" @click="store.aiClearLogs()">
        清空
      </button>
      <p v-if="store.aiLogs.length === 0" class="panel__hint">还没有调用过</p>
      <p v-for="(log, index) in store.aiLogs" :key="index" class="ai-log" data-role="ai-log">
        {{ log.ok ? '✓' : '✗' }} {{ log.kind }} · {{ log.provider }} · {{ log.ms }}ms · {{ log.tokens }} tokens · {{ log.prompt.slice(0, 30) }}
      </p>
    </div>
  </section>
</template>
