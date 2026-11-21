import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { BotServiceError } from './bot-service.server'
import { setPluginConfigAssociations, type PluginConfigType } from '../plugins/plugin-config-links.server'

const headers={'Cache-Control':'no-store'}
const types=z.enum(['command','keyboard','keyreply','keyreply_keyboard'])
const permissions={
  command:['修改命令','admin.telegram.command.update'],
  keyboard:['修改键盘名称','admin.telegram.keyboard.update'],
  keyreply:['修改关键字回复','admin.telegram.keyreply.update'],
  keyreply_keyboard:['修改关键字键盘','admin.telegram.keyreplyboard.update'],
} as const
export function pluginConfigLinksApi(request:Request){return run(async()=>{
  const user=await identity(request)
  if(request.method!=='POST')return Response.json({message:'请求方法不支持'},{status:405,headers})
  const expected=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:''
  if(!expected||request.headers.get('origin')!==expected||!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({message:'请求来源无效'},{status:403,headers})
  const input=z.object({type:types,config_rid:z.coerce.number().int().positive(),bot_rid:z.coerce.number().int().nonnegative().default(0),plugin_ids:z.array(z.string()).max(8).default([]),reset_auto:z.boolean().default(false)}).strict().parse(await request.json())
  const [permission,route]=permissions[input.type]
  if(!can(user,permission,route))return Response.json({message:'没有修改关联的权限'},{status:403,headers})
  try{
    const result=await setPluginConfigAssociations(db,{type:input.type as PluginConfigType,configRid:input.config_rid,botRid:input.bot_rid,pluginIds:input.plugin_ids,actor:user.id,resetAuto:input.reset_auto})
    return Response.json({ok:true,data:result,message:'插件关联已保存'},{headers})
  }catch(error){
    const code=error instanceof Error?error.message:'plugin_config_association_failed'
    if(code.startsWith('plugin_config_'))return Response.json({message:code==='plugin_config_missing'?'配置记录不存在':code==='plugin_config_bot_mismatch'?'机器人和配置不匹配':code==='plugin_config_unknown_plugin'?'插件无效':'插件关联保存失败'},{status:code==='plugin_config_missing'?404:400,headers})
    if(error instanceof BotServiceError)return Response.json({message:error.message},{status:error.status,headers})
    throw error
  }
})}
