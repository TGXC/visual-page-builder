import GroupBlock from '@/components/shared/fields/GroupBlock.vue'
import type { ComponentDescriptor } from './registry'

export const groupField: ComponentDescriptor<{
  description: string
  bordered: boolean
}> = {
  type: 'group',
  label: '分组',
  icon: 'group',
  isContainer: true,
  hasValue: false,
  defaultProps: { description: '', bordered: true },
  propSchema: [
    { key: 'description', label: '分组说明', control: 'textarea' },
    { key: 'bordered', label: '显示边框', control: 'switch' },
  ],
  component: GroupBlock,
}
