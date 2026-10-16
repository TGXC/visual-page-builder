import { registerComponent } from './registry'
import { numberField } from './number'
import { selectField } from './select'
import { textField } from './text'

let registered = false

/**
 * 注册全部内置字段。幂等：入口与测试都会 import 这个文件，
 * 重复初始化不应该撞上「字段类型已注册」。
 */
export function registerBuiltinFields(): void {
  if (registered) return
  registered = true

  // 顺序 = 组件面板里的顺序
  registerComponent(textField)
  registerComponent(numberField)
  registerComponent(selectField)
}

registerBuiltinFields()

export * from './registry'
export { textField } from './text'
export { numberField } from './number'
export { selectField } from './select'
