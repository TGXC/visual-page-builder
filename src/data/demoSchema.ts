import type { FormSchema } from '@/core/types'

/**
 * M2 阶段先硬编码一份 schema，用来验证「同一份 JSON 在编辑器与预览页渲染一致」。
 * M3 起画布改为从 store 读取，这份数据会降级成「新建表单的初始示例」。
 */
export const demoSchema: FormSchema = {
  version: 1,
  id: 'demo-form',
  name: '活动报名表',
  description: '这是一份示例表单，用来验证编辑器与预览页渲染的是同一份数据。',
  fields: [
    {
      id: 'f_name',
      parentId: null,
      order: 0,
      type: 'text',
      name: 'name',
      label: '姓名',
      props: { placeholder: '请输入真实姓名', maxlength: 20, clearable: true },
      rules: [{ kind: 'required' }],
      visibleWhen: null,
    },
    {
      id: 'f_age',
      parentId: null,
      order: 1,
      type: 'number',
      name: 'age',
      label: '年龄',
      props: { placeholder: '请输入年龄', min: 0, max: 120, step: 1 },
      rules: [],
      visibleWhen: null,
    },
    {
      id: 'f_city',
      parentId: null,
      order: 2,
      type: 'select',
      name: 'city',
      label: '所在城市',
      props: {
        placeholder: '请选择城市',
        options: [
          { label: '北京', value: 'beijing' },
          { label: '上海', value: 'shanghai' },
          { label: '深圳', value: 'shenzhen' },
        ],
        clearable: true,
      },
      rules: [{ kind: 'required' }],
      visibleWhen: null,
    },
  ],
  settings: { labelPosition: 'top', submitText: '提交报名' },
}
