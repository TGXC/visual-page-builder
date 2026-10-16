import NumberInput from '@/components/shared/fields/NumberInput.vue'
import type { ComponentDescriptor } from './registry'

export const numberField: ComponentDescriptor<{
  placeholder: string
  min: number
  max: number
  step: number
}> = {
  type: 'number',
  label: '数字',
  icon: 'number',
  defaultProps: { placeholder: '请输入数字', min: 0, max: 100, step: 1 },
  propSchema: [
    { key: 'placeholder', label: '占位提示', control: 'text' },
    { key: 'min', label: '最小值', control: 'number' },
    { key: 'max', label: '最大值', control: 'number' },
    { key: 'step', label: '步长', control: 'number' },
  ],
  component: NumberInput,
}
