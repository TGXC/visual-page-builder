import { registerComponent } from './registry'
import { checkboxField } from './checkbox'
import { dateField } from './date'
import { dividerField } from './divider'
import { groupField } from './group'
import { numberField } from './number'
import { radioField } from './radio'
import { ratingField } from './rating'
import { selectField } from './select'
import { switchField } from './switch'
import { textField } from './text'
import { textareaField } from './textarea'

let registered = false

/**
 * 注册全部内置字段（11 类）。幂等：入口与测试都会 import 这个文件，
 * 重复初始化不应该撞上「字段类型已注册」。
 * 注册顺序 = 组件面板里的顺序，容器（group）放最后。
 */
export function registerBuiltinFields(): void {
  if (registered) return
  registered = true

  registerComponent(textField)
  registerComponent(textareaField)
  registerComponent(numberField)
  registerComponent(selectField)
  registerComponent(radioField)
  registerComponent(checkboxField)
  registerComponent(switchField)
  registerComponent(dateField)
  registerComponent(ratingField)
  registerComponent(dividerField)
  registerComponent(groupField)
}

registerBuiltinFields()

export * from './registry'
export { textField } from './text'
export { textareaField } from './textarea'
export { numberField } from './number'
export { selectField } from './select'
export { radioField } from './radio'
export { checkboxField } from './checkbox'
export { switchField } from './switch'
export { dateField } from './date'
export { ratingField } from './rating'
export { dividerField } from './divider'
export { groupField } from './group'
