import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { pluginCatalog } from '@/plugins/catalog'

type ConfigType='command'|'keyboard'|'keyreply'|'keyreply_keyboard'
type Props={type:ConfigType;rid:number;botRid:number;pluginIds?:string[];pluginNames?:string[];effective?:boolean;manual?:boolean;canEdit:boolean;invalidateKey:unknown[]}
export function PluginConfigAssociation({type,rid,botRid,pluginIds=[],pluginNames=[],effective=true,manual=false,canEdit,invalidateKey}:Props){
 const client=useQueryClient(),[open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>(pluginIds)
 const save=useMutation({mutationFn:(resetAuto:boolean)=>api('/api/plugin-config-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,config_rid:rid,bot_rid:botRid,plugin_ids:resetAuto?[]:selected,reset_auto:resetAuto})}),onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:invalidateKey})}})
 const toggle=(id:string,checked:boolean)=>setSelected(current=>checked?[...new Set([...current,id])]:current.filter(value=>value!==id))
 return <div className="flex min-w-0 flex-col gap-1">
  <div className="flex min-w-0 flex-wrap items-center gap-1">{pluginNames.length?pluginNames.map(name=><Badge key={name} variant="outline" className="max-w-24 truncate px-1.5 py-0 text-[10px]">{name}</Badge>):<span className="text-[10px] text-muted-foreground">共享</span>}<Badge variant={effective?'secondary':'destructive'} className="px-1.5 py-0 text-[10px]">{effective?'生效':'受插件停用'}</Badge><span className="text-[10px] text-muted-foreground">{manual?'手动关联':'自动识别'}</span></div>
  {canEdit&&<Button type="button" variant="ghost" size="sm" className="h-6 w-fit px-1.5 text-[10px]" onClick={()=>{setSelected([...pluginIds]);save.reset();setOpen(true)}}>调整关联</Button>}
  <Dialog open={open} onOpenChange={value=>!save.isPending&&setOpen(value)}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">配置归属插件</DialogTitle></DialogHeader><p className="text-xs text-muted-foreground">可选择多个插件。停用后所有关联插件都不可用时，此配置暂停生效；不选择插件则作为共享配置。</p><div className="space-y-2">{pluginCatalog.map(plugin=><label key={plugin.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"><Checkbox checked={selected.includes(plugin.id)} onCheckedChange={value=>toggle(plugin.id,value===true)}/><span>{plugin.name}</span></label>)}</div>{save.error&&<p role="alert" className="text-xs text-destructive">{save.error instanceof Error?save.error.message:'保存关联失败'}</p>}<DialogFooter><Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={()=>save.mutate(true)}>恢复自动识别</Button><Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={()=>setOpen(false)}>取消</Button><Button type="button" size="sm" disabled={save.isPending} onClick={()=>save.mutate(false)}>{save.isPending?'保存中':'保存'}</Button></DialogFooter></DialogContent></Dialog>
 </div>
}
