import SelectInput from '@/components/shared/fields/SelectInput.vue'
import type { ComponentDescriptor } from './registry'

export const selectField: ComponentDescriptor<{
  placeholder: string
  options: Array<{ label: string; value: string | number }>
  clearable: boolean
}> = {
  type: 'select',
  label: '下拉选择',
  icon: 'select',
  defaultProps: {
    placeholder: '请选择',
    options: [
      { label: '选项一', value: 'option-1' },
      { label: '选项二', value: 'option-2' },
    ],
    clearable: true,
  },
  propSchema: [
    { key: 'placeholder', label: '占位提示', control: 'text' },
    { key: 'options', label: '选项列表', control: 'options' },
    { key: 'clearable', label: '可清空', control: 'switch' },
  ],
  component: SelectInput,
}
