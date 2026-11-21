import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parse } from "@babel/parser"
import { api, ApiError } from "../lib/api"
import { translateApiMessage } from "../lib/api-messages"
import { currentLocale, setRuntimeLocale } from "../lib/i18n"

test("static administrative API messages are translated in all UI locales", () => {
  const sourceRoot = join(process.cwd(), "src")
  const candidates = new Map<string, string>()
  const keyName = (node: any) => node && (node.name || node.value)
  const collectStatic = (node: any, file: string): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "StringLiteral" && /[\u3400-\u9fff]/.test(node.value)) {
      candidates.set(node.value, relative(sourceRoot, file))
      return
    }
    if (node.type === "ConditionalExpression") {
      collectStatic(node.consequent, file)
      collectStatic(node.alternate, file)
    }
  }
  const walk = (node: any, file: string): void => {
    if (!node || typeof node !== "object") return
    if (node.type === "ObjectProperty" && keyName(node.key) === "message") collectStatic(node.value, file)
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.id.name === "message") collectStatic(node.init, file)
    if (node.type === "AssignmentExpression" && node.operator === "=" && node.left?.type === "Identifier" && node.left.name === "message") collectStatic(node.right, file)
    for (const [key, value] of Object.entries(node)) {
      if (["loc","start","end","extra","leadingComments","trailingComments","innerComments"].includes(key)) continue
      if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(child => walk(child, file))
        else walk(value, file)
      }
    }
  }
  const visit = (directory: string, kind: "routes" | "server"): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) { visit(file, kind); continue }
      const isApiRoute = kind === "routes" && /^api\..+\.tsx?$/.test(entry.name)
      const isApiHandler = kind === "server" && /-api\.server\.ts$/.test(entry.name)
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue
      if (!isApiRoute && !isApiHandler) continue
      const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] })
      walk(ast, file)
    }
  }
  visit(join(sourceRoot, "routes"), "routes")
  visit(join(sourceRoot, "server"), "server")
  const missing = [...candidates].filter(([message]) => ["en","ru","ja"].some(locale => translateApiMessage(message, locale as any) === message))
  assert.deepEqual(missing.map(([message, file]) => ({ file, message })), [])
})

test("dynamic API messages localize counts, summaries, and prefixes", () => {
  assert.match(translateApiMessage("群组策略已保存，最近 30 分钟已回扫并处理 12 条消息，2 条处理失败；1 条验证挑战未能启动，已回退为删除消息", "en"), /processed 12 messages; 2 failed/)
  assert.match(translateApiMessage("群组策略已保存，最近 30 分钟已回扫并处理 12 条消息，2 条处理失败；1 条验证挑战未能启动，已回退为删除消息", "ja"), /12件を処理しました/)
  assert.equal(translateApiMessage("已添加 3 个钱包，跳过重复 2 个", "ja"), "ウォレット 3 件を追加しました。重複 2 件はスキップしました")
  assert.equal(translateApiMessage("发送失败：Telegram said no", "ru"), "Ошибка отправки: Telegram said no")
  assert.equal(translateApiMessage("已添加 4 条，跳过重复 1 条", "en"), "Added 4 entries; skipped 1 duplicates")
  assert.equal(translateApiMessage("第 7 行格式无效，应为卡号,卡密", "ja"), "行 7 の形式が無効です。カード番号, カードキーを指定してください")
  assert.equal(translateApiMessage("上架完成，共更新 5 条", "en"), "Listed; updated 5 items")
})

test("API helper localizes success and error messages while keeping business fields intact", async () => {
  const originalFetch = globalThis.fetch
  const originalLocale = currentLocale()
  try {
    setRuntimeLocale("en")
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, message: "商品已添加", businessText: "商品已添加" }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
    const result = await api<{ message: string; businessText: string }>("/fixture")
    assert.equal(result.message, "Product added")
    assert.equal(result.businessText, "商品已添加")
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "机器人不存在" }), { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch
    await assert.rejects(() => api("/fixture"), error => error instanceof ApiError && error.message === "Bot not found")
  } finally {
    globalThis.fetch = originalFetch
    setRuntimeLocale(originalLocale)
  }
})
