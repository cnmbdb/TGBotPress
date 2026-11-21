import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@babel/parser"
import { translateUiText } from "../lib/ui-locale-extra"

test("route and shared-component string resources cover the backend UI", () => {
  const sourceRoot = join(process.cwd(), "src")
  const candidates = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== "string" || !/[\u3400-\u9fff]/.test(value)) return
    if ([...value].filter(char => /[\u3400-\u9fff]/.test(char)).length >= 2 && value.length <= 160) candidates.add(value)
  }
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "StringLiteral") add(node.value)
    if (node.type === "TemplateLiteral") for (const part of node.quasis ?? []) add(part.value?.cooked)
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
      else if (file.endsWith(".tsx")) walk(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }))
    }
  }
  visit(join(sourceRoot, "routes"))
  visit(join(sourceRoot, "components"))
  const missing = [...candidates].filter(value => translateUiText(value, "en") === value)
  assert.deepEqual(missing, [])
})
