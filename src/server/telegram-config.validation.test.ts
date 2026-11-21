import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandScopes, normalizeCustomEmojiId } from './telegram-config-service.server'
import { configPermissions } from './telegram-config-api.server'

test('common, private and group commands reach the correct Telegram scopes',()=>{
 const scopes=commandScopes([{command:'common',description:'Common',command_type:1},{command:'private',description:'Private',command_type:2},{command:'group',description:'Group',command_type:3}])
 assert.deepEqual(scopes.all_private_chats.map(row=>row.command),['common','private'])
 assert.deepEqual(scopes.all_group_chats.map(row=>row.command),['common','group'])
 assert.throws(()=>commandScopes([{command:'/bad',description:'Bad',command_type:1}]))
 assert.throws(()=>commandScopes(Array.from({length:101},(_,i)=>({command:`c${i}`,description:'x',command_type:1}))))
 assert.deepEqual(commandScopes([]),{all_private_chats:[],all_group_chats:[]})
})
test('custom emoji normalizes the original HTML and numeric input formats without truncating IDs',()=>{
 assert.equal(normalizeCustomEmojiId('<tg-emoji emoji-id="1234567890123456789">icon</tg-emoji>'),'1234567890123456789')
 assert.equal(normalizeCustomEmojiId('ID: 123 456'),'123456')
 assert.equal(normalizeCustomEmojiId('0'),null)
 assert.equal(normalizeCustomEmojiId(''),null)
 assert.throws(()=>normalizeCustomEmojiId('1'.repeat(65)))
})
test('command and keyboard operation permissions remain separate',()=>{
 const user={id:'1',name:'test',roles:[],permissions:['添加命令','修改键盘名称'],routes:[]}
 assert.equal(configPermissions(user,'command').add,true)
 assert.equal(configPermissions(user,'command').sync,false)
 assert.equal(configPermissions(user,'command').copy,false)
 assert.equal(configPermissions(user,'keyboard').add,false)
 assert.equal(configPermissions(user,'keyboard').status,true)
 assert.equal(configPermissions(user,'keyboard').sync,false)
})
