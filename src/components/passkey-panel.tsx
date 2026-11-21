import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { Fingerprint, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type Settings = { enabled:boolean; rp_name:string; rp_id:string; origins:string[]; user_verification:'required'|'preferred'; attachment:''|'platform'|'cross-platform'; allow_insecure_origin:boolean }
type Credential = { rid:string; name:string; rp_id:string; created_at:string; last_used_at:string|null }
type PasskeyData = { settings:Settings; credentials:Credential[]; canManage:boolean }
type RegisterFlow = { flow_token:string; options:PublicKeyCredentialCreationOptionsJSON; name:string }
type Action = { type:'save' }|{ type:'register' }|{ type:'revoke'; rid:string }
const initialSettings:Settings={enabled:false,rp_name:'TGBotPress',rp_id:'localhost',origins:[],user_verification:'required',attachment:'',allow_insecure_origin:false}
const jsonHeaders={ 'Content-Type':'application/json' }
export function PasskeyPanel({ canManage }: { canManage:boolean }) {
  useLocale()
  const client=useQueryClient()
  const [form,setForm]=useState<Settings|null>(null)
  const [notice,setNotice]=useState<{text:string;error:boolean}|null>(null)
  const [action,setAction]=useState<Action|null>(null)
  const [password,setPassword]=useState('')
  const [credentialName,setCredentialName]=useState('')
  const [registerFlow,setRegisterFlow]=useState<RegisterFlow|null>(null)
  const data=useQuery({queryKey:['passkey-management'],queryFn:()=>api<PasskeyData>('/api/passkey-management'),retry:false})
  useEffect(()=>{if(data.data?.settings)setForm(data.data.settings)},[data.data?.settings])
  const update=useMutation({
    mutationFn:(payload:Record<string,unknown>)=>api<{message:string}>('/api/passkey-management',{method:'POST',headers:jsonHeaders,body:JSON.stringify(payload)}),
    onSuccess:async result=>{setNotice({text:result.message,error:false});setAction(null);setPassword('');setRegisterFlow(null);await client.invalidateQueries({queryKey:['passkey-management']})},
    onError:error=>setNotice({text:error instanceof ApiError?error.message:'通行密钥操作失败',error:true}),
  })
  const save=useMutation({
    mutationFn:(payload:{settings:Settings;password:string})=>api<{message:string}>('/api/passkey-management',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'save-settings',...payload})}),
    onSuccess:async result=>{setNotice({text:result.message,error:false});setAction(null);setPassword('');await client.invalidateQueries({queryKey:['passkey-management']})},
    onError:error=>setNotice({text:error instanceof ApiError?error.message:'保存通行密钥设置失败',error:true}),
  })
  const pending=update.isPending||save.isPending
  const submitPassword=async(event:React.FormEvent)=>{
    event.preventDefault();if(!action||!password)return
    setNotice(null)
    if(action.type==='save'&&form){save.mutate({settings:form,password});return}
    if(action.type==='register'){
      try {
        const result=await api<{options:PublicKeyCredentialCreationOptionsJSON;flow_token:string}>('/api/passkey-management',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'register-options',password})})
        setRegisterFlow({...result,name:credentialName.trim()||'通行密钥'});setAction(null);setPassword('');setNotice({text:'验证器已准备，请继续完成注册',error:false})
      } catch(error) {setNotice({text:error instanceof ApiError?error.message:'无法准备通行密钥注册',error:true})}
      return
    }
    if(action.type==='revoke')update.mutate({action:'revoke',rid:action.rid,password})
  }
  const beginRegistration=async()=>{
    if(!registerFlow)return
    setNotice(null)
    try {
      const credential=await startRegistration({optionsJSON:registerFlow.options})
      const result=await api<{message:string}>('/api/passkey-management',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'register-finish',flow_token:registerFlow.flow_token,credential,name:registerFlow.name})})
      setRegisterFlow(null);setNotice({text:result.message,error:false});await client.invalidateQueries({queryKey:['passkey-management']})
    } catch(error) {setNotice({text:error instanceof ApiError?error.message:error instanceof Error?error.message:'通行密钥注册失败',error:true})}
  }
  const settings=form||data.data?.settings||initialSettings
  const patch=(value:Partial<Settings>)=>setForm(current=>({...current||initialSettings,...value}))
  return <section className="overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-muted-foreground"/>通行密钥</h2><span className={`rounded-full px-2 py-1 text-[11px] ${settings.enabled?'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':'bg-muted text-muted-foreground'}`}>{settings.enabled?'已启用':'未启用'}</span></div>
    <div className="space-y-3 p-4">
      {notice&&<div role={notice.error?'alert':'status'} className={`rounded-lg border px-3 py-2 text-xs ${notice.error?'border-destructive/30 text-destructive':'text-muted-foreground'}`}>{notice.text}</div>}
      {data.isError&&<div role="alert" className="text-xs text-destructive">{data.error instanceof ApiError?data.error.message:'通行密钥信息读取失败'}</div>}
      {canManage&&<div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"><span>启用 Passkey 登录</span><Switch checked={settings.enabled} onCheckedChange={enabled=>patch({enabled})}/></label>
        <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"><span>允许本地 HTTP（仅 localhost）</span><Switch checked={settings.allow_insecure_origin} onCheckedChange={allow_insecure_origin=>patch({allow_insecure_origin})}/></label>
        <label className="space-y-1 text-[11px] text-muted-foreground">显示名称<Input value={settings.rp_name} maxLength={80} onChange={event=>patch({rp_name:event.target.value})}/></label>
        <label className="space-y-1 text-[11px] text-muted-foreground">RP ID<Input value={settings.rp_id} maxLength={253} onChange={event=>patch({rp_id:event.target.value})}/></label>
        <label className="space-y-1 text-[11px] text-muted-foreground">用户验证<Select value={settings.user_verification} onValueChange={user_verification=>patch({user_verification:user_verification as Settings['user_verification']})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="required">必须验证</SelectItem><SelectItem value="preferred">优先验证</SelectItem></SelectContent></Select></label>
        <label className="space-y-1 text-[11px] text-muted-foreground">设备偏好<Select value={settings.attachment||'any'} onValueChange={value=>patch({attachment:value==='any'?'':value as Settings['attachment']})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="any">不限</SelectItem><SelectItem value="platform">本机设备</SelectItem><SelectItem value="cross-platform">安全密钥</SelectItem></SelectContent></Select></label>
        <label className="space-y-1 text-[11px] text-muted-foreground sm:col-span-2">允许的 Origins（每行一个）<Textarea className="min-h-16 font-mono text-xs" value={settings.origins.join('\n')} onChange={event=>patch({origins:event.target.value.split(/[\s,]+/).filter(Boolean)})}/></label>
        <div className="flex justify-end sm:col-span-2"><Button size="sm" disabled={pending} onClick={()=>setAction({type:'save'})}>保存设置</Button></div>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-medium">已注册设备 <span className="text-muted-foreground">{data.data?.credentials.length||0}/10</span></div><Button size="sm" variant="outline" disabled={!settings.enabled||pending||!!registerFlow} onClick={()=>{setCredentialName('');setAction({type:'register'})}}><Fingerprint className="mr-1.5 size-3.5"/>添加设备</Button></div>
      {registerFlow&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"><span className="text-xs">正在添加：{registerFlow.name}</span><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={()=>setRegisterFlow(null)}>取消</Button><Button size="sm" onClick={beginRegistration}><KeyRound className="mr-1.5 size-3.5"/>继续注册</Button></div></div>}
      <div className="divide-y rounded-lg border">{data.data?.credentials.map(item=><div key={item.rid} className="flex flex-wrap items-center gap-2 px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-md bg-muted"><Fingerprint className="size-3.5"/></span><div className="min-w-0 flex-1"><div className="text-xs font-medium">{item.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{item.rp_id} · 添加于 {formatDate(item.created_at)} · 最近使用 {formatDate(item.last_used_at)}</div></div><Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={`移除 ${item.name}`} disabled={pending} onClick={()=>setAction({type:'revoke',rid:item.rid})}><Trash2 className="size-3.5"/></Button></div>)}{!data.data?.credentials.length&&<div className="px-3 py-5 text-center text-xs text-muted-foreground">暂无通行密钥</div>}</div>
      {!settings.enabled&&<div className="text-[11px] text-muted-foreground">启用设置后，管理员可使用通行密钥登录。</div>}
    </div>
    <Dialog open={action!==null} onOpenChange={open=>{if(!open){setAction(null);setPassword('')}}}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle className="text-sm">{action?.type==='save'?'保存 Passkey 设置':action?.type==='register'?'注册通行密钥':'移除通行密钥'}</DialogTitle></DialogHeader><form className="space-y-3" onSubmit={submitPassword}>{action?.type==='register'&&<label className="block space-y-1 text-xs">设备名称<Input autoFocus value={credentialName} maxLength={80} onChange={event=>setCredentialName(event.target.value)} placeholder="例如：工作手机"/></label>}<label className="block space-y-1 text-xs">当前管理员密码<Input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={()=>setAction(null)}>取消</Button><Button type="submit" size="sm" disabled={pending||!password}>{pending&&<LoaderCircle className="mr-1.5 size-3.5 animate-spin"/>}确认</Button></div></form></DialogContent></Dialog>
  </section>
}
function formatDate(value:unknown){return formatLocaleDateTime(value)}
