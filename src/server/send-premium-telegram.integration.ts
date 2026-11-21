import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {sendPremiumTelegramNotifications} from './send-premium-telegram.server'
const url=process.env.PREMIUM_TEST_DATABASE_URL
test('premium notification worker delivers to order user and matching platform admin',{skip:!url},async()=>{const parsed=new URL(url!);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/premium_test');const pool=new Pool({connectionString:url,max:3}),old=process.env.PLATFORM_TELEGRAM_ACTIONS;process.env.PLATFORM_TELEGRAM_ACTIONS='true';const calls:Array<{chatId:string;text:string}>=[];try{await pool.query(`
DROP TABLE IF EXISTS t_premium_platform_order,t_premium_platform,t_telegram_bot CASCADE;
CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text);
CREATE TABLE t_premium_platform(rid integer PRIMARY KEY,bot_rid integer,tg_admin_uid text);
CREATE TABLE t_premium_platform_order(rid integer PRIMARY KEY,bot_rid integer,premium_platform_rid integer,buy_tg_uid text,premium_tg_username text,premium_package_month integer,comments text,tg_notice_user char(1) NOT NULL,tg_notice_admin char(1) NOT NULL);
INSERT INTO t_telegram_bot VALUES(7,'fixture-token');
INSERT INTO t_premium_platform VALUES(71,7,'-1071'),(72,7,'-1072');
INSERT INTO t_premium_platform_order VALUES(12,7,71,'1012','test_user',12,'fixture comment','Y','Y');
`);const prev=globalThis.fetch;globalThis.fetch=(async(_u:RequestInfo|URL,i?:RequestInit)=>{const b=JSON.parse(String(i?.body));calls.push({chatId:String(b.chat_id),text:b.text});return Response.json({ok:true})}) as typeof fetch;try{assert.deepEqual(await sendPremiumTelegramNotifications({pool,logger:{info(){},error(){}}}),{skipped:false,scanned:1,sent:2,failed:0});assert.deepEqual(calls.map(x=>x.chatId),['1012','-1071']);assert.match(calls[1].text,/fixture comment/);const state=await pool.query('SELECT tg_notice_user,tg_notice_admin FROM t_premium_platform_order WHERE rid=12');assert.deepEqual(state.rows[0],{tg_notice_user:'N',tg_notice_admin:'N'})}finally{globalThis.fetch=prev}}finally{if(old==null)delete process.env.PLATFORM_TELEGRAM_ACTIONS;else process.env.PLATFORM_TELEGRAM_ACTIONS=old;await pool.end()}})
