import DividerBlock from '@/components/shared/fields/DividerBlock.vue'
import type { ComponentDescriptor } from './registry'

export const dividerField: ComponentDescriptor<{
  text: string
  dashed: boolean
}> = {
  type: 'divider',
  label: '分隔线',
  icon: 'divider',
  // 只做排版，不产出值
  hasValue: false,
  defaultProps: { text: '', dashed: false },
  propSchema: [
    { key: 'text', label: '分隔文字', control: 'text' },
    { key: 'dashed', label: '虚线', control: 'switch' },
  ],
  component: DividerBlock,
}
