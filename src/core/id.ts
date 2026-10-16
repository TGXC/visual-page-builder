import { nanoid } from 'nanoid'

/**
 * 生成稳定 id。不用数组下标：下标会在删除、排序后失效，
 * 选中态与历史记录都会跟着错位。
 */
export function createId(prefix = 'f'): string {
  return `${prefix}_${nanoid(10)}`
}
