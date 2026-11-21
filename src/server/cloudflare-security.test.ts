import { test } from "node:test"
import assert from "node:assert/strict"
import { isExpectedTurnstileResult } from "./cloudflare-security.server"

test("Turnstile enforces hostname and action",()=>{
  assert.equal(isExpectedTurnstileResult({success:true,hostname:"example.test",action:"login"},"example.test","login"),true)
  for(const result of [{success:false,hostname:"example.test",action:"login"},{success:true,hostname:"other.test",action:"login"},{success:true,hostname:"example.test",action:"signup"},null]) assert.equal(isExpectedTurnstileResult(result,"example.test","login"),false)
})
