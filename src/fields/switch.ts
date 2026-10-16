import SwitchInput from '@/components/shared/fields/SwitchInput.vue'
import type { ComponentDescriptor } from './registry'

export const switchField: ComponentDescriptor<{
  activeText: string
  inactiveText: string
}> = {
  type: 'switch',
  label: '开关',
  icon: 'switch',
  defaultProps: { activeText: '', inactiveText: '' },
  propSchema: [
    { key: 'activeText', label: '开启时文案', control: 'text' },
    { key: 'inactiveText', label: '关闭时文案', control: 'text' },
  ],
  component: SwitchInput,
}
