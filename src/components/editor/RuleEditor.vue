<script setup lang="ts">
import { computed } from 'vue'
import type { CustomRuleName, FieldNode, ValidationRule } from '@/core/types'

/**
 * 校验规则编辑器：哑组件，规则数组整体 emit 出去（属性面板再走 updateField 进历史栈）。
 * 规则里不放函数（D2/D3 的前提），所以这里只编辑 kind / value / name 三种数据。
 */
const props = defineProps<{ field: FieldNode }>()

const emit = defineEmits<{ (e: 'update:rules', rules: ValidationRule[]): void }>()

type RuleKind = ValidationRule['kind']

const KINDS: Array<{ kind: RuleKind; label: string }> = [
  { kind: 'required', label: '必填' },
  { kind: 'minLength', label: '最少字数' },
  { kind: 'maxLength', label: '最多字数' },
  { kind: 'pattern', label: '正则表达式' },
  { kind: 'min', label: '最小值' },
  { kind: 'max', label: '最大值' },
  { kind: 'custom', label: '内置校验' },
]

const CUSTOM_NAMES: Array<{ name: CustomRuleName; label: string }> = [
  { name: 'phone', label: '手机号' },
  { name: 'email', label: '邮箱' },
  { name: 'idcard', label: '身份证号' },
]

const NUMERIC_KINDS: RuleKind[] = ['minLength', 'maxLength', 'min', 'max']

const rules = computed<ValidationRule[]>(() => props.field.rules)

function defaultRule(kind: RuleKind): ValidationRule {
  switch (kind) {
    case 'required':
      return { kind }
    case 'custom':
      return { kind, name: 'phone' }
    case 'minLength':
      return { kind, value: 1 }
    case 'maxLength':
      return { kind, value: 50 }
    case 'min':
      return { kind, value: 0 }
    case 'max':
      return { kind, value: 100 }
    case 'pattern':
      return { kind, value: '^\\d+$' }
  }
}

function replace(index: number, rule: ValidationRule): void {
  emit(
    'update:rules',
    rules.value.map((item, i) => (i === index ? rule : item)),
  )
}

function addRule(event: Event): void {
  const select = event.target as HTMLSelectElement
  const kind = select.value as RuleKind | ''
  select.value = ''
  if (kind === '') return
  emit('update:rules', [...rules.value, defaultRule(kind)])
}

function setKind(index: number, event: Event): void {
  replace(index, defaultRule((event.target as HTMLSelectElement).value as RuleKind))
}

function setCustomName(index: number, event: Event): void {
  replace(index, { kind: 'custom', name: (event.target as HTMLSelectElement).value as CustomRuleName })
}

function setValue(index: number, event: Event): void {
  const rule = rules.value[index]
  if (!rule || rule.kind === 'required' || rule.kind === 'custom') return
  const raw = (event.target as HTMLInputElement).value
  if (rule.kind === 'pattern') {
    replace(index, { kind: 'pattern', value: raw })
    return
  }
  const parsed = Number(raw)
  replace(index, { kind: rule.kind, value: raw.trim() === '' || Number.isNaN(parsed) ? 0 : parsed })
}

function removeRule(index: number): void {
  emit(
    'update:rules',
    rules.value.filter((_, i) => i !== index),
  )
}

function hasValue(rule: ValidationRule): boolean {
  return rule.kind !== 'required' && rule.kind !== 'custom'
}

function showValue(rule: ValidationRule): string {
  return 'value' in rule ? String(rule.value) : ''
}

function isNumeric(rule: ValidationRule): boolean {
  return NUMERIC_KINDS.includes(rule.kind)
}
</script>

<template>
  <fieldset class="fb-rules">
    <legend class="fb-rules__legend">校验规则</legend>

    <p v-if="rules.length === 0" class="fb-rules__empty">还没有校验规则</p>

    <div v-for="(rule, index) in rules" :key="index" class="fb-rule">
      <select class="fb-rule__kind" :data-index="index" :value="rule.kind" @change="setKind(index, $event)">
        <option v-for="item in KINDS" :key="item.kind" :value="item.kind">{{ item.label }}</option>
      </select>

      <select
        v-if="rule.kind === 'custom'"
        class="fb-rule__custom"
        :data-index="index"
        :value="rule.name"
        @change="setCustomName(index, $event)"
      >
        <option v-for="item in CUSTOM_NAMES" :key="item.name" :value="item.name">{{ item.label }}</option>
      </select>

      <input
        v-else-if="hasValue(rule)"
        class="fb-rule__value"
        :data-index="index"
        :type="isNumeric(rule) ? 'number' : 'text'"
        :value="showValue(rule)"
        @input="setValue(index, $event)"
      />

      <button type="button" class="fb-rule__remove" :data-index="index" title="删除这条规则" @click="removeRule(index)">
        ×
      </button>
    </div>

    <label class="fb-rules__add-row">
      <span class="fb-rules__add-label">添加规则</span>
      <select class="fb-rule__add" value="" @change="addRule">
        <option value="">选择规则类型</option>
        <option v-for="item in KINDS" :key="item.kind" :value="item.kind">{{ item.label }}</option>
      </select>
    </label>
  </fieldset>
</template>
