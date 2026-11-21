import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@babel/parser"
import { translateUiAttribute } from "../lib/ui-locale-attributes"

test("dynamic accessible labels and placeholders have locale-aware templates", () => {
  const sourceRoot = join(process.cwd(), "src")
  const candidates = new Map<string, { attribute: string; value: string; file: string }>()
  const uiAttributes = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description"])
  const variants = (node: any): string[] => {
    if (!node) return ["1"]
    if (node.type === "StringLiteral") return [node.value]
    if (node.type === "ConditionalExpression") return [...variants(node.consequent), ...variants(node.alternate)]
    if (node.type === "TemplateLiteral") {
      let values = [""]
      node.quasis.forEach((part: any, index: number) => {
        values = values.map(value => value + (part.value?.cooked ?? ""))
        if (index < node.expressions.length) values = values.flatMap(value => variants(node.expressions[index]).map(replacement => value + replacement))
      })
      return values
    }
    if (node.type === "BinaryExpression" && node.operator === "+") return variants(node.left).flatMap(left => variants(node.right).map(right => left + right))
    return ["1"]
  }
  const walk = (node: any, file: string): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "JSXAttribute" && uiAttributes.has(node.name?.name) && node.value?.type === "JSXExpressionContainer") {
      for (const value of variants(node.value.expression)) {
        if (/[\u3400-\u9fff]/.test(value)) candidates.set(file + "\0" + node.name.name + "\0" + value, { attribute: node.name.name, value, file })
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(child => walk(child, file))
        else walk(value, file)
      }
    }
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (file.endsWith(".tsx")) walk(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }), file)
    }
  }
  visit(join(sourceRoot, "routes"))
  visit(join(sourceRoot, "components"))
  const missing = [...candidates.values()].filter(item => translateUiAttribute(item.value, "en", item.attribute) === item.value)
  assert.deepEqual(missing.map(item => ({ file: item.file, attribute: item.attribute, value: item.value })), [])
})

test("dynamic accessibility translations preserve the displayed record name", () => {
  assert.equal(translateUiAttribute("展开机器人 3 详情", "en", "aria-label"), "Expand bot 3 details")
  assert.equal(translateUiAttribute("删除商品名称", "en", "aria-label"), "Delete 商品名称")
  assert.equal(translateUiAttribute("启用监控钱包 5", "ru", "aria-label"), "Включить кошелёк мониторинга №5")
  assert.equal(translateUiAttribute("键盘 16 启用状态", "en", "aria-label"), "Keyboard 16 enabled status")
})
