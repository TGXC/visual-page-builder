<script setup lang="ts">
/**
 * AI 面板（M6）：供应商切换 + 一句话生成页面 + 选区指令 + 规则检查/一键修复 + 调用记录。
 * 面板只调用 store 暴露的 AI 动作；所有落库与历史都在 store 里完成。
 */
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const pagePrompt = ref('')
const instruction = ref('')
const showSettings = ref(false)
const showLogs = ref(false)
const apiKey = ref(store.aiSettings.apiKey)
const baseUrl = ref(store.aiSettings.baseUrl)
const model = ref(store.aiSettings.model)

const issueCount = computed(() => store.aiIssues.length)
const fixableCount = computed(() => store.aiIssues.filter((issue) => issue.patches.length > 0).length)
const selectionLabel = computed(() =>
  store.selection.length === 0 ? '未选中元素' : `已选中 ${store.selection.length} 个元素`,
)

async function generate(): Promise<void> {
  if (await store.aiGeneratePage(pagePrompt.value)) pagePrompt.value = ''
}

async function edit(): Promise<void> {
  if (await store.aiEditSelection(instruction.value)) instruction.value = ''
}

function onProvider(event: Event): void {
  store.aiSetProvider((event.target as HTMLSelectElement).value)
}

function saveSettings(): void {
  store.aiSaveSettings({ apiKey: apiKey.value, baseUrl: baseUrl.value, model: model.value })
  store.pushToast('AI 设置已保存在本机浏览器')
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

    <button type="button" class="ai-link" data-role="ai-logs-toggle" @click="showLogs = !showLogs">
      {{ showLogs ? '收起调用记录' : `调用记录（${store.aiLogs.length}）` }}
    </button>
    <div v-if="showLogs" class="ai-logs">
      <button type="button" class="ai-link ai-link--inline" data-role="ai-logs-clear" @click="store.aiClearLogs()">
        清空
      </button>
      <p v-if="store.aiLogs.length === 0" class="panel__hint">还没有调用过</p>
      <p v-for="(log, index) in store.aiLogs" :key="index" class="ai-log" data-role="ai-log">
        {{ log.ok ? '✓' : '✗' }} {{ log.kind }} · {{ log.provider }} · {{ log.ms }}ms · {{ log.prompt.slice(0, 30) }}
      </p>
    </div>
  </section>
</template>
