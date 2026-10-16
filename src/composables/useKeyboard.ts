import { onMounted, onUnmounted } from 'vue'

export interface UseKeyboardOptions {
  onDelete?: () => void
  onDuplicate?: () => void
  onEscape?: () => void
}

/** 在输入框里按 Delete 是在删字，不是在删字段。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return element.isContentEditable === true
}

/**
 * 编辑器快捷键（只装了 M3 需要的三个）：
 * Delete/Backspace 删除选中字段、Ctrl/Cmd+D 复制、Escape 交给拖拽自己处理。
 */
export function useKeyboard(options: UseKeyboardOptions = {}): void {
  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return

    if (event.key === 'Escape') {
      options.onEscape?.()
      return
    }

    const modifier = event.ctrlKey || event.metaKey

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (modifier) return
      event.preventDefault()
      options.onDelete?.()
      return
    }

    if (modifier && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault()
      options.onDuplicate?.()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
}
