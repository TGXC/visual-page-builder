<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseSchemaJson, schemaFileName, toJsonText } from '@/core/schema'
import { SHARE_URL_LIMIT, buildShareUrl, isTooLong } from '@/core/share'
import type { FormSchema } from '@/core/types'

/**
 * 导入 / 导出 / 分享。哑组件：只往外抛 `import`，换不换 schema 由父级决定。
 * 三件事都不经过后端：导出是本地下载，分享是把压缩后的 schema 塞进链接。
 */
const props = defineProps<{ schema: FormSchema }>()

const emit = defineEmits<{ import: [schema: FormSchema] }>()

const error = ref('')
const copied = ref(false)

const shareUrl = computed(() => buildShareUrl(props.schema, window.location.origin))
const tooLong = computed(() => isTooLong(shareUrl.value))

function downloadText(filename: string, text: string): void {
  // 某些环境（老旧浏览器 / 测试环境）没有 Blob URL，这时宁可不下载也不要抛
  if (typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function onExport(): void {
  error.value = ''
  downloadText(schemaFileName(props.schema), toJsonText(props.schema))
}

async function onImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const result = parseSchemaJson(await file.text())
  // 清空 input，这样同一个文件可以再导入一次
  input.value = ''
  if (!result.ok) {
    error.value = result.error
    return
  }
  error.value = ''
  emit('import', result.schema)
}

function onFocus(event: Event): void {
  ;(event.target as HTMLInputElement).select()
}

async function onCopy(): Promise<void> {
  copied.value = false
  const clipboard = navigator.clipboard
  if (!clipboard) {
    // 不假装复制成功：让用户自己选中
    error.value = '这个浏览器不支持自动复制，请手动选中链接复制'
    return
  }
  try {
    await clipboard.writeText(shareUrl.value)
    error.value = ''
    copied.value = true
  } catch {
    error.value = '复制失败，请手动选中链接复制'
  }
}
</script>

<template>
  <section class="fb-io">
    <h3 class="fb-io__title">导入 / 导出 / 分享</h3>

    <div class="fb-io__row">
      <button type="button" class="fb-io__export fb-button" @click="onExport">导出 JSON</button>
      <label class="fb-io__import fb-button">
        导入 JSON
        <input class="fb-io__file" type="file" accept="application/json,.json" @change="onImport" />
      </label>
    </div>

    <label class="fb-io__share">
      <span class="fb-io__share-label">分享链接</span>
      <input
        class="fb-io__share-link"
        type="text"
        readonly
        :value="shareUrl"
        title="复制这条链接给别人，打开就能填"
        @focus="onFocus"
      />
    </label>

    <button type="button" class="fb-io__copy fb-button" @click="onCopy">复制分享链接</button>

    <p v-if="tooLong" class="fb-io__warn">
      链接已经超过 {{ SHARE_URL_LIMIT }} 个字符：部分浏览器和聊天工具会截断，建议改用「导出 JSON」发给对方。
    </p>
    <p v-if="error" class="fb-io__error">{{ error }}</p>
    <p v-if="copied" class="fb-io__copied">已复制到剪贴板</p>
  </section>
</template>
