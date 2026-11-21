import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from '@babel/parser'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, locales, translateMessage, translateText } from '../lib/i18n'
import { untranslatedTextSelector } from '../lib/locale-dom'

test('global locale resources expose all requested languages and common interface labels', () => {
  assert.deepEqual(locales, ['zh-CN', 'en', 'ru', 'ja'])
  assert.equal(translateText('搜索命令', 'en'), 'Search commands')
  assert.equal(translateText('搜索命令', 'ru'), 'Поиск команд')
  assert.equal(translateText('搜索命令', 'ja'), 'コマンドを検索')
  assert.equal(translateMessage('机器人不存在', 'ru'), 'Бот не найден')
  assert.equal(translateText('用户 ID', 'ja'), 'ユーザー ID')
})

test("native select option labels remain translatable while user-entered content stays excluded", () => {
  assert.match(untranslatedTextSelector, /input/)
  assert.match(untranslatedTextSelector, /textarea/)
  assert.doesNotMatch(untranslatedTextSelector, /select|option/)
  assert.match(untranslatedTextSelector, /contenteditable/)
})

test('dynamic counts, pagination, and durations follow the selected locale', () => {
  assert.equal(translateText('共 3 个角色', 'en'), 'Total 3 roles')
  assert.equal(translateText('第 1 / 4 页', 'en'), 'Page 1 / 4')
  assert.equal(translateText('3 条 · 第 1 / 4 页', 'ru'), '3 шт. · Страница 1 из 4')
  assert.equal(translateText('第 1 / 4 页 · 3 条', 'ja'), '1 / 4ページ · 3件')
  assert.equal(translateText('3 个月', 'ja'), '3か月')
  assert.equal(translateText('3 天', 'ru'), '3 дня')
})

test('unknown text falls back to its original value', () => {
  assert.equal(translateText('未登记文案', 'en'), '未登记文案')
})

test('numbers and dates use the requested regional format', () => {
  assert.equal(formatLocaleNumber(1234.5, { maximumFractionDigits: 1 }, 'en'), '1,234.5')
  assert.equal(formatLocaleNumber(1234.5, { maximumFractionDigits: 1 }, 'ja'), '1,234.5')
  assert.ok(formatLocaleDate('2026-11-14T12:34:56Z', 'ru').startsWith('14.11.2026'))
  assert.match(formatLocaleDateTime('2026-11-14T12:34:56Z', 'en'), /20:34/)
})

test('route and shared-component JSX literals are covered by the central catalog', () => {
  const sourceRoot = join(process.cwd(), 'src')
  const candidates = new Set<string>()
  const uiAttributes = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label'])
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') return
    const text = raw.replace(/\s+/g, ' ').trim()
    if ([...text].filter(char => /[\u3400-\u9fff]/.test(char)).length < 2 || text.length > 100) return
    candidates.add(text)
  }
  const walk = (node: any, parent?: any): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) walk(child, parent); return }
    if (node.type === 'JSXText') add(node.value)
    if (node.type === 'JSXAttribute' && uiAttributes.has(node.name?.name)) {
      if (node.value?.type === 'StringLiteral') add(node.value.value)
      if (node.value?.type === 'JSXExpressionContainer' && node.value.expression?.type === 'TemplateLiteral') {
        for (const part of node.value.expression.quasis ?? []) add(part.value?.cooked)
      }
    }
    if (node.type === 'StringLiteral' && parent?.type === 'JSXExpressionContainer') add(node.value)
    if (node.type === 'StringLiteral' && parent?.type === 'CallExpression' &&
        ['t', 'translateText', 'translateMessage'].includes(parent.callee?.name)) add(node.value)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (value && typeof value === 'object') walk(value, node)
    }
  }
  const visitDirectory = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visitDirectory(file)
      else if (file.endsWith('.tsx')) {
        const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
        walk(ast)
      }
    }
  }
  visitDirectory(join(sourceRoot, 'routes'))
  visitDirectory(join(sourceRoot, 'components'))
  const missing = [...candidates].filter(text => translateText(text, 'en') === text)
  assert.deepEqual(missing, [])
})
