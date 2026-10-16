import RadioInput from '@/components/shared/fields/RadioInput.vue'
import type { ComponentDescriptor, SelectOption } from './registry'

export const defaultChoiceOptions: SelectOption[] = [
  { label: '选项一', value: 'option-1' },
  { label: '选项二', value: 'option-2' },
  { label: '选项三', value: 'option-3' },
]

export const radioField: ComponentDescriptor<{
  options: SelectOption[]
  inline: boolean
}> = {
  type: 'radio',
  label: '单选',
  icon: 'radio',
  defaultProps: { options: defaultChoiceOptions.map(option => ({ ...option })), inline: false },
  propSchema: [
    { key: 'options', label: '选项', control: 'options' },
    { key: 'inline', label: '横向排列', control: 'switch' },
  ],
  component: RadioInput,
}
