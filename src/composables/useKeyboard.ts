import { onMounted, onUnmounted } from 'vue'

export interface UseKeyboardOptions {
  onDelete?: () => void
  onDuplicate?: () => void
  onEscape?: () => void
  onUndo?: () => void
  onRedo?: () => void
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
 * 编辑器快捷键：
 * Delete/Backspace 删除选中字段、Ctrl/Cmd+D 复制、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z（或 Ctrl+Y）重做。
 * Escape 交给拖拽自己处理（拖拽中取消）。
 */
export function useKeyboard(options: UseKeyboardOptions = {}): void {
  function onKeyDown(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey

    // 撤销/重做是全局动作：焦点在属性面板的输入框里时也该生效
    if (modifier && !event.altKey) {
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) options.onRedo?.()
        else options.onUndo?.()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        options.onRedo?.()
        return
      }
    }

    if (isTypingTarget(event.target)) return

    if (event.key === 'Escape') {
      options.onEscape?.()
      return
    }

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
