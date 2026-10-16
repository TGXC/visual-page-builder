import TextareaInput from '@/components/shared/fields/TextareaInput.vue'
import type { ComponentDescriptor } from './registry'

export const textareaField: ComponentDescriptor<{
  placeholder: string
  rows: number
  maxlength: number
}> = {
  type: 'textarea',
  label: '多行文本',
  icon: 'textarea',
  defaultProps: { placeholder: '请输入', rows: 4, maxlength: 200 },
  propSchema: [
    { key: 'placeholder', label: '占位提示', control: 'text' },
    { key: 'rows', label: '显示行数', control: 'number' },
    { key: 'maxlength', label: '最大长度', control: 'number' },
  ],
  defaultRules: [{ kind: 'maxLength', value: 200 }],
  component: TextareaInput,
}
