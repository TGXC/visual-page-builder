import DateInput from '@/components/shared/fields/DateInput.vue'
import type { ComponentDescriptor } from './registry'

export const dateField: ComponentDescriptor<{
  min: string
  max: string
}> = {
  type: 'date',
  label: '日期',
  icon: 'date',
  defaultProps: { min: '', max: '' },
  propSchema: [
    { key: 'min', label: '最早日期', control: 'text', placeholder: 'YYYY-MM-DD' },
    { key: 'max', label: '最晚日期', control: 'text', placeholder: 'YYYY-MM-DD' },
  ],
  component: DateInput,
}
