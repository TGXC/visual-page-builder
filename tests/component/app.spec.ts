import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '@/App.vue'
import { createDoc } from '@/core/schema'
import { legacyProductLanding, legacyStorageShape } from '../unit/fixtures/legacyV1'

describe('App 壳：新建项目与导入 WebBuilder 项目', () => {
  it('初始是空状态，没有元素行', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.studio-empty').exists()).toBe(true)
    expect(wrapper.findAll('.studio-node-row')).toHaveLength(0)
    expect(wrapper.find('.studio-project__name').exists()).toBe(false)
  })

  it('新建项目后显示项目名、一个页面、零元素', async () => {
    const wrapper = mount(App)
    await wrapper.find('.studio-new').trigger('click')
    expect(wrapper.find('.studio-project__name').text()).toBe('我的站点')
    expect(wrapper.text()).toContain('已新建项目')
    expect(wrapper.findAll('.studio-page-tab')).toHaveLength(1)
    expect(wrapper.findAll('.studio-node-row')).toHaveLength(0)
    expect(wrapper.find('.studio-message--error').exists()).toBe(false)
  })

  it('粘贴 WebBuilder 导出文件：迁移成功并按源顺序列出 8 个元素', async () => {
    const wrapper = mount(App)
    await wrapper.find('.studio-textarea').setValue(JSON.stringify(legacyProductLanding))
    await wrapper.find('.studio-import__apply').trigger('click')

    expect(wrapper.text()).toContain('已从 WebBuilder v1 迁移：1 页 / 8 个元素')
    expect(wrapper.find('.studio-project__name').text()).toBe('WebBuilder 导入的项目')

    const rows = wrapper.findAll('.studio-node-row')
    expect(rows).toHaveLength(8)
    expect(rows.map((row) => row.attributes('data-node-id'))).toEqual([
      'el1', 'el2', 'el3', 'el4', 'el5', 'el6', 'el7', 'el8',
    ])

    const first = rows[0]
    expect(first.find('.studio-node-row__type').text()).toBe('nav')
    expect(first.find('.studio-node-row__pos').text()).toBe('0, 0')
    expect(first.find('.studio-node-row__size').text()).toBe('1440 × 60')
    expect(first.find('.studio-node-row__text').text()).toBe('Product 功能 价格 关于')

    const button = rows[2]
    expect(button.find('.studio-node-row__type').text()).toBe('button')
    expect(button.find('.studio-node-row__size').text()).toBe('200 × 46')
  })

  it('坏 JSON 显示可读错误，且不改动文档', async () => {
    const wrapper = mount(App)
    await wrapper.find('.studio-textarea').setValue('{')
    await wrapper.find('.studio-import__apply').trigger('click')
    expect(wrapper.find('.studio-message--error').text()).toBe('不是合法的 JSON 文件')
    expect(wrapper.find('.studio-empty').exists()).toBe(true)
  })

  it('多页存档：默认停在 activePageId，点标签可切页', async () => {
    const wrapper = mount(App)
    await wrapper.find('.studio-textarea').setValue(JSON.stringify(legacyStorageShape))
    await wrapper.find('.studio-import__apply').trigger('click')

    const tabs = wrapper.findAll('.studio-page-tab')
    expect(tabs.map((tab) => tab.text())).toEqual(['首页', '关于我们'])
    expect(tabs[1].classes()).toContain('studio-page-tab--active')
    expect(wrapper.findAll('.studio-node-row')).toHaveLength(1)

    await tabs[0].trigger('click')
    const afterSwitch = wrapper.findAll('.studio-page-tab')
    expect(afterSwitch[0].classes()).toContain('studio-page-tab--active')
    expect(wrapper.findAll('.studio-node-row')).toHaveLength(3)
  })

  it('v2 文档也能直接导入', async () => {
    const wrapper = mount(App)
    await wrapper.find('.studio-textarea').setValue(JSON.stringify(createDoc('我的站点')))
    await wrapper.find('.studio-import__apply').trigger('click')
    expect(wrapper.text()).toContain('已导入 v2 文档：1 页 / 0 个元素')
    expect(wrapper.find('.studio-project__name').text()).toBe('我的站点')
    expect(wrapper.find('.studio-message--error').exists()).toBe(false)
  })
})
