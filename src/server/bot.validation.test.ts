import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configuredWebhookOrigin, configuredWebhookUrl, webhookSecret, BotServiceError, telegramRequest } from './bot-service.server'
import { isTronAddress, validLocalDate, botPermissions } from './bots-api.server'

test('TRON recharge addresses require the Base58Check checksum',()=>{
 assert.equal(isTronAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'),true)
 assert.equal(isTronAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwa'),false)
 assert.equal(isTronAddress('0x0000000000000000000000000000000000000000'),false)
})
test('local transaction start times reject overflow dates and preserve clear',()=>{
 for(const value of ['', '2024-02-29T12:20','2026-10-27T23:59:59']) assert.equal(validLocalDate(value),true)
 for(const value of ['2025-02-29T12:20','2026-04-31T01:00','2026-10-27T24:00','2026-10-27T12:60','2026-10-27T12:20Z']) assert.equal(validLocalDate(value),false)
})
test('webhook targets use only explicit secure configured origins',()=>{
 assert.equal(configuredWebhookUrl('https://worker.example/base',7),'https://worker.example/base/api/telegram/getdata?rid=7')
 for(const value of ['', 'http://worker.example','https://user:pass@worker.example','https://worker.example:8080','https://worker.example?target=1','https://worker.example/#fragment']) assert.throws(()=>configuredWebhookUrl(value,7),BotServiceError)
 assert.throws(()=>webhookSecret(7,'token','short',''),BotServiceError)
 assert.equal(webhookSecret(7,'token','01234567890123456789012345678901','').length,64)
 assert.notEqual(webhookSecret(7,'token','01234567890123456789012345678901',''),webhookSecret(8,'token','01234567890123456789012345678901',''))
})
test('copy and recharge remain super-admin operations',()=>{
 const user={id:'1',name:'test',roles:[],permissions:['添加机器人','修改机器人','更新机器人','注册Webhook','删除机器人'],routes:[]}
 assert.deepEqual(botPermissions(user),{add:true,update:true,refresh:true,webhook:true,delete:true,clone:false,recharge:false})
 assert.deepEqual(botPermissions({...user,roles:['超级管理员']}),{add:true,update:true,refresh:true,webhook:true,delete:true,clone:true,recharge:true})
})

test('webhook origin prefers its dedicated host, then legacy compatibility origins',()=>{
 assert.equal(configuredWebhookOrigin({telegramWebhookOrigin:'https://bot.example',webUrl:'https://web.example',platformOrigin:'https://platform.example',appUrl:'https://legacy.example'}),'https://bot.example')
 assert.equal(configuredWebhookOrigin({webhookPublicOrigin:'https://bot.example',platformOrigin:'https://platform.example'}),'https://bot.example')
 assert.equal(configuredWebhookOrigin({webUrl:'https://web.example',platformOrigin:'https://platform.example',appUrl:'https://legacy.example'}),'https://web.example')
 assert.equal(configuredWebhookOrigin({webUrl:' ',platformOrigin:'https://platform.example',appUrl:'https://legacy.example'}),'https://platform.example')
 assert.equal(configuredWebhookOrigin({platformOrigin:'',appUrl:'https://legacy.example'}),'https://legacy.example')
 assert.equal(configuredWebhookOrigin({}), '')
})


test('Telegram 401 errors identify the rejected stored bot token without forwarding upstream text',async()=>{
 const originalActions=process.env.PLATFORM_TELEGRAM_ACTIONS
 const originalFetch=globalThis.fetch
 process.env.PLATFORM_TELEGRAM_ACTIONS='true'
 globalThis.fetch=async()=>Response.json({ok:false,error_code:401,description:'Unauthorized'},{status:401})
 try {
  await assert.rejects(telegramRequest('123456:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN','setWebhook'),error=>error instanceof BotServiceError && error.status===502 && error.message==='Telegram 已拒绝此机器人令牌（401 Unauthorized），请在机器人设置中更新有效令牌')
 } finally {
  if(originalActions===undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
  else process.env.PLATFORM_TELEGRAM_ACTIONS=originalActions
  globalThis.fetch=originalFetch
 }
})
