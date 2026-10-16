import TextInput from '@/components/shared/fields/TextInput.vue'
import type { ComponentDescriptor } from './registry'

export const textField: ComponentDescriptor<{
  placeholder: string
  maxlength: number
  clearable: boolean
}> = {
  type: 'text',
  label: '单行文本',
  icon: 'text',
  defaultProps: { placeholder: '请输入', maxlength: 50, clearable: false },
  propSchema: [
    { key: 'placeholder', label: '占位提示', control: 'text', placeholder: '未填写时显示的灰字' },
    { key: 'maxlength', label: '最大长度', control: 'number' },
    { key: 'clearable', label: '可清空', control: 'switch' },
  ],
  defaultRules: [{ kind: 'maxLength', value: 50 }],
  component: TextInput,
}
