import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@babel/parser"
import { translateUiText } from "../lib/ui-locale-extra"

test("conditional JSX labels, prompts, and attributes have English translations", () => {
  const sourceRoot = join(process.cwd(), "src")
  const candidates = new Set<string>()
  const uiAttributes = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description"])
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return
    const value = raw.replace(/\s+/g, " ").trim()
    if ([...value].filter(char => /[\u3400-\u9fff]/.test(char)).length >= 2 && value.length <= 120) candidates.add(value)
  }
  const collect = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "StringLiteral") add(node.value)
    if (node.type === "TemplateLiteral") for (const part of node.quasis ?? []) add(part.value?.cooked)
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(collect)
        else collect(value)
      }
    }
  }
  const walk = (node: any, parent?: any): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "JSXText") add(node.value)
    if (node.type === "JSXAttribute" && uiAttributes.has(node.name?.name)) collect(node.value)
    if (node.type === "JSXExpressionContainer" && parent?.type === "JSXElement") collect(node.expression)
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(child => walk(child, node))
        else walk(value, node)
      }
    }
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (file.endsWith(".tsx")) walk(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }))
    }
  }
  visit(join(sourceRoot, "routes"))
  visit(join(sourceRoot, "components"))
  const missing = [...candidates].filter(value => translateUiText(value, "en") === value)
  assert.deepEqual(missing, [])
})

test("extra locale resources handle dynamic quantities and preserve JSX spacing", () => {
  assert.equal(translateUiText("运行中", "ja"), "稼働中")
  assert.equal(translateUiText("10 个监控包", "ru"), "Пакетов мониторинга: 10")
  assert.equal(translateUiText(" 保存中… ", "en"), " Saving… ")
})
