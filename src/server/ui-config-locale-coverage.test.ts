import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@babel/parser"
import { translateUiText } from "../lib/ui-locale-extra"

test("configuration-driven interface labels and options have translations", () => {
  const sourceRoot = join(process.cwd(), "src/config")
  const candidates = new Set<string>()
  const uiKeys = new Set(["label", "title", "search", "singular", "options"])
  const add = (value: unknown) => {
    if (typeof value !== "string") return
    if ([...value].filter(char => /[\u3400-\u9fff]/.test(char)).length >= 2) candidates.add(value)
  }
  const collectStrings = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "StringLiteral") add(node.value)
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(collectStrings)
        else collectStrings(value)
      }
    }
  }
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "ObjectProperty" && uiKeys.has(node.key?.name ?? node.key?.value)) collectStrings(node.value)
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(walk)
        else walk(value)
      }
    }
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (file.endsWith(".ts") || file.endsWith(".tsx")) walk(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }))
    }
  }
  visit(sourceRoot)
  const missing = [...candidates].filter(value => translateUiText(value, "en") === value)
  assert.deepEqual(missing, [])
})
