import RatingInput from '@/components/shared/fields/RatingInput.vue'
import type { ComponentDescriptor } from './registry'

export const ratingField: ComponentDescriptor<{
  max: number
}> = {
  type: 'rating',
  label: '评分',
  icon: 'rating',
  defaultProps: { max: 5 },
  propSchema: [
    { key: 'max', label: '最高分', control: 'number' },
  ],
  // 不预置 min：没打分就是「空值」，空值只由 required 负责，拖进来不该立刻算错
  component: RatingInput,
}
