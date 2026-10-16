import CheckboxInput from '@/components/shared/fields/CheckboxInput.vue'
import type { ComponentDescriptor, SelectOption } from './registry'
import { defaultChoiceOptions } from './radio'

export const checkboxField: ComponentDescriptor<{
  options: SelectOption[]
  inline: boolean
}> = {
  type: 'checkbox',
  label: '多选',
  icon: 'checkbox',
  defaultProps: { options: defaultChoiceOptions.map(option => ({ ...option })), inline: false },
  propSchema: [
    { key: 'options', label: '选项', control: 'options' },
    { key: 'inline', label: '横向排列', control: 'switch' },
  ],
  component: CheckboxInput,
}
