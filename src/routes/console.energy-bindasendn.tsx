import { useLocale } from '@/components/locale-provider'
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '@/lib/i18n'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, ChevronLeft, ChevronRight, CircleAlert, KeyRound, RefreshCw, Search, ShieldCheck, WalletCards, X } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type Config = { rid:number|null; is_enable:boolean; energy_per_send:number; activate_threshold:string; daily_limit:number; monthly_limit:number; n_addr_daily_limit:number; audit_threshold:string; audit_enabled:boolean; whitelist:string; blacklist:string; retry_count:number; energy_platform_bot_rid:number|null }
type Bot = { rid:number; bot_username:string|null; bot_firstname:string|null }
type Instance = { rid:number; bot_rid:number|null; bot_username:string|null; bot_firstname:string|null; receive_wallet:string|null }
type ConfigData = { config:Config; bots:Bot[]; instances:Instance[]; canSave:boolean }
type Binding = { rid:number; bot_rid:number; bot_username:string|null; bot_firstname:string|null; tg_uid:string; wallet_addr:string; status:number; status_label:string; activate_threshold:string; activate_time:string|null; create_time:string|null; unbind_time:string|null; unbind_reason:string|null }
type Grant = { rid:number; binding_rid:number; bot_rid:number; bot_username:string|null; bot_firstname:string|null; tg_uid:string; a_addr:string; n_addr:string; tx_hash:string; energy_amount:number; grant_status:number; grant_status_label:string; audit_status:number; retry_count:number; fail_reason:string|null; grant_time:string|null; create_time:string|null }
type PageData<T> = { rows:T[]; total:number; page:number; pageSize:number; bots:Bot[]; canActivate?:boolean; canUnbind?:boolean; canRetry?:boolean; canReview?:boolean }
type Intent = { kind:'activate'|'unbind'; row:Binding } | { kind:'retry'|'approve'|'reject'; row:Grant } | null
const emptyConfig:Config = { rid:null, is_enable:true, energy_per_send:65000, activate_threshold:'0', daily_limit:9999, monthly_limit:9999, n_addr_daily_limit:9999, audit_threshold:'0', audit_enabled:false, whitelist:'', blacklist:'', retry_count:3, energy_platform_bot_rid:null }
const emptyFilters = { bot_rid:'all', status:'all', tg_uid:'', wallet_addr:'', a_addr:'', n_addr:'', tx_hash:'', date_start:'', date_end:'' }
const pageSizes = [10,15,20,30,50,100]
const fallback = (value:string|null|undefined) => value || '—'
const displayBot = (row:Bot) => row.bot_username ? '@'+row.bot_username : row.bot_firstname || '机器人 #'+row.rid
const statusTone = (status:number) => status===1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : status===2 || status===3 ? 'bg-muted text-muted-foreground' : 'bg-amber-50 text-amber-700 border-amber-200'
const grantTone = (status:number) => status===1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : status===2 ? 'bg-red-50 text-red-700 border-red-200' : status===3 ? 'bg-muted text-muted-foreground' : 'bg-amber-50 text-amber-700 border-amber-200'
export const Route = createFileRoute('/console/energy-bindasendn')({ component: BindASendNPage })

function BindASendNPage() {
  useLocale()
 const qc=useQueryClient()
 const me=useQuery({queryKey:['me'],queryFn:()=>api<AdminUser>('/api/me'),retry:false,staleTime:60_000})
 const logout=useMutation({mutationFn:()=>api('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),onSuccess:()=>{qc.clear();window.location.assign('/console/home')}})
 const [tab,setTab]=useState('config'),[config,setConfig]=useState(emptyConfig),[draft,setDraft]=useState(emptyFilters),[filters,setFilters]=useState(emptyFilters),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(15)
 const [intent,setIntent]=useState<Intent>(null),[feedback,setFeedback]=useState(''),[unbindReason,setUnbindReason]=useState('管理员解绑')
 const configQuery=useQuery({queryKey:['bindasendn','config'],queryFn:()=>api<ConfigData>('/api/bindasendn?view=config'),enabled:!!me.data,retry:false})
 useEffect(()=>{if(configQuery.data?.config)setConfig(configQuery.data.config)},[configQuery.data])
 const searchParams:Record<string,string> = tab==='bindings'
  ? {view:'bindings',page:String(page),pageSize:String(pageSize),bot_rid:filters.bot_rid==='all'?'':filters.bot_rid,status:filters.status==='all'?'':filters.status,tg_uid:filters.tg_uid,wallet_addr:filters.wallet_addr}
  : {view:'grants',page:String(page),pageSize:String(pageSize),bot_rid:filters.bot_rid==='all'?'':filters.bot_rid,a_addr:filters.a_addr,n_addr:filters.n_addr,tx_hash:filters.tx_hash,status:filters.status==='all'?'':filters.status,date_start:filters.date_start,date_end:filters.date_end}
 const rowsQuery=useQuery({queryKey:['bindasendn',tab,page,pageSize,filters],queryFn:()=>api<PageData<Binding|Grant>>('/api/bindasendn?'+new URLSearchParams(searchParams)),enabled:!!me.data&&(tab==='bindings'||tab==='grants'),retry:false})
 const mutation=useMutation({mutationFn:(body:Record<string,unknown>)=>api<{message:string}>('/api/bindasendn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),onSuccess:async result=>{setIntent(null);setFeedback(result.message);await Promise.all([qc.invalidateQueries({queryKey:['bindasendn','config']}),qc.invalidateQueries({queryKey:['bindasendn','bindings']}),qc.invalidateQueries({queryKey:['bindasendn','grants']})])}})
 if(me.isPending)return <div className="grid min-h-screen place-items-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="加载中"/></div>
 if(!me.data)return <main className="grid min-h-screen place-items-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4"/>TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=energyBindASendN"><KeyRound className="size-4"/>管理员登录</a></Button></section></main>
 const bots=configQuery.data?.bots||rowsQuery.data?.bots||[],records=rowsQuery.data?.rows||[],total=rowsQuery.data?.total||0,pages=Math.max(1,Math.ceil(total/pageSize))
 const updateConfig=<K extends keyof Config>(key:K,value:Config[K])=>setConfig(current=>({...current,[key]:value}))
 const submitConfig=(event:FormEvent)=>{event.preventDefault();mutation.mutate({action:'configSave',...config,energy_platform_bot_rid:config.energy_platform_bot_rid||null})}
 const applyFilters=(event:FormEvent)=>{event.preventDefault();setFilters({...draft});setPage(1)}
 const confirmIntent=()=>{if(!intent)return;if(intent.kind==='activate')mutation.mutate({action:'bindingActivate',rid:intent.row.rid});if(intent.kind==='unbind')mutation.mutate({action:'bindingUnbind',rid:intent.row.rid,reason:unbindReason.trim()||'管理员解绑'});if(intent.kind==='retry')mutation.mutate({action:'grantRetry',rid:intent.row.rid});if(intent.kind==='approve')mutation.mutate({action:'grantApprove',rid:intent.row.rid});if(intent.kind==='reject')mutation.mutate({action:'grantReject',rid:intent.row.rid})}
 const refresh=()=>tab==='config'?configQuery.refetch():rowsQuery.refetch()
 const field=(label:string,child:ReactNode,className='')=><label className={'grid gap-1.5 text-xs '+className}><span className="font-medium text-muted-foreground">{label}</span>{child}</label>
 const numberInput=(key:'energy_per_send'|'daily_limit'|'monthly_limit'|'n_addr_daily_limit'|'retry_count',label:string,min=0)=>
  field(label,<Input type="number" min={min} step="1" value={config[key]} onChange={e=>updateConfig(key,Number(e.target.value))} className="h-9 text-xs"/>)
 const moneyInput=(key:'activate_threshold'|'audit_threshold',label:string)=>
  field(label,<Input type="number" min="0" step="0.01" value={config[key]} onChange={e=>updateConfig(key,e.target.value)} className="h-9 text-xs"/>)
 const botName=(row:{bot_username:string|null;bot_firstname:string|null;bot_rid:number})=>row.bot_username?'@'+row.bot_username:row.bot_firstname||'机器人 #'+row.bot_rid
 const auditLabel=(status:number)=>({0:'无需审核',1:'待审核',2:'已通过',3:'已拒绝'} as Record<number,string>)[status]||'未知'
 const error=mutation.error instanceof ApiError?mutation.error.message:mutation.error?'操作失败，请重试':''
 const intentDetails=intent?.kind==='activate'||intent?.kind==='unbind'?intent.row.wallet_addr:intent?.kind==='retry'||intent?.kind==='approve'||intent?.kind==='reject'?intent.row.n_addr:''
 const tableFooter=<footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">{total} 条 · 第 {page}/{pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={value=>{setPageSize(Number(value));setPage(1)}}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue/></SelectTrigger><SelectContent>{pageSizes.map(size=><SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page<=1||rowsQuery.isFetching} onClick={()=>setPage(value=>value-1)}><ChevronLeft className="size-3.5"/></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page>=pages||rowsQuery.isFetching} onClick={()=>setPage(value=>value+1)}><ChevronRight className="size-3.5"/></Button></div></footer>
 return <AdminShell user={me.data} title="绑A送N" activeRoute="admin.energy.bindasendn.config" onRefresh={()=>refresh()} onLogout={()=>logout.mutate()}>
  <main className="space-y-3 p-3 sm:p-4">
   {feedback&&<Dialog open onOpenChange={open=>{if(!open)setFeedback('')}}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-sm">{feedback}</DialogTitle></DialogHeader><DialogFooter><Button size="sm" onClick={()=>setFeedback('')}>确定</Button></DialogFooter></DialogContent></Dialog>}
   <Tabs value={tab} onValueChange={value=>{setTab(value);setPage(1);mutation.reset()}} className="space-y-3">
    <TabsList className="grid w-full grid-cols-3 sm:w-[420px]"><TabsTrigger value="config">全局配置</TabsTrigger><TabsTrigger value="bindings">绑定记录</TabsTrigger><TabsTrigger value="grants">发放记录</TabsTrigger></TabsList>
    <TabsContent value="config" className="mt-0">
     {configQuery.error&&<div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive">{configQuery.error instanceof ApiError?configQuery.error.message:'配置读取失败'}</div>}
     <form onSubmit={submitConfig} className="space-y-3">
      <section className="rounded-xl bg-card p-3 sm:p-4">
       <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div className="flex items-center gap-2 text-sm font-semibold"><WalletCards className="size-4 text-muted-foreground"/>自动发放</div><div className="flex items-center gap-2"><Badge variant={config.is_enable?'default':'secondary'} className={config.is_enable?'bg-emerald-600 hover:bg-emerald-600':''}>{config.is_enable?'已开启':'已关闭'}</Badge><Switch checked={config.is_enable} onCheckedChange={value=>updateConfig('is_enable',value)} aria-label="绑A送N功能开关"/></div></div>
       <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field('机器人能量实例',<Select value={config.energy_platform_bot_rid?String(config.energy_platform_bot_rid):'none'} onValueChange={value=>updateConfig('energy_platform_bot_rid',value==='none'?null:Number(value))}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="选择实例"/></SelectTrigger><SelectContent><SelectItem value="none">未选择</SelectItem>{(configQuery.data?.instances||[]).map(instance=><SelectItem key={instance.rid} value={String(instance.rid)}>{instance.bot_username?'@'+instance.bot_username:instance.bot_firstname||'机器人 #'+(instance.bot_rid||0)} · {fallback(instance.receive_wallet)}</SelectItem>)}</SelectContent></Select>)}
        {numberInput('energy_per_send','单次发放能量',1)}
        {moneyInput('activate_threshold','激活门槛余额 TRX')}
       </div>
      </section>
      <section className="rounded-xl bg-card p-3 sm:p-4"><div className="mb-3 flex items-center gap-2 border-b pb-3 text-sm font-semibold"><BadgeCheck className="size-4 text-muted-foreground"/>次数限制与审核</div>
       <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {numberInput('daily_limit','每人每日上限（0 不限）')}
        {numberInput('monthly_limit','每人每月上限（0 不限）')}
        {numberInput('n_addr_daily_limit','每个 N 地址每日上限（0 不限）')}
        {numberInput('retry_count','失败重试次数')}
        {field('大额转账审核',<div className="flex h-9 items-center justify-between rounded-md border px-3"><span>{config.audit_enabled?'开启':'关闭'}</span><Switch checked={config.audit_enabled} onCheckedChange={value=>updateConfig('audit_enabled',value)} aria-label="大额审核开关"/></div>)}
        {moneyInput('audit_threshold','审核阈值 USDT')}
       </div>
      </section>
      <section className="rounded-xl bg-card p-3 sm:p-4"><div className="mb-3 flex items-center gap-2 border-b pb-3 text-sm font-semibold"><ShieldCheck className="size-4 text-muted-foreground"/>地址过滤</div>
       <div className="grid gap-3 lg:grid-cols-2">
        {field('白名单地址',<Textarea rows={3} value={config.whitelist} onChange={e=>updateConfig('whitelist',e.target.value)} className="min-h-20 resize-y font-mono text-xs" placeholder="英文逗号分隔；留空不限制"/>)}
        {field('黑名单地址',<Textarea rows={3} value={config.blacklist} onChange={e=>updateConfig('blacklist',e.target.value)} className="min-h-20 resize-y font-mono text-xs" placeholder="英文逗号分隔"/>)}
       </div>
      </section>
      {error&&<p role="alert" className="rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive">{error}</p>}
      <div className="flex justify-end"><Button size="sm" className="h-9 min-w-28" disabled={mutation.isPending||configQuery.isPending||!configQuery.data?.canSave}>{mutation.isPending?'保存中…':'保存配置'}</Button></div>
     </form>
    </TabsContent>
    <TabsContent value="bindings" className="mt-0 space-y-3">
     <form onSubmit={applyFilters} className="grid gap-2 rounded-xl bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
      <Select value={draft.bot_rid} onValueChange={value=>setDraft({...draft,bot_rid:value})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部机器人</SelectItem>{bots.map(bot=><SelectItem key={bot.rid} value={String(bot.rid)}>{displayBot(bot)}</SelectItem>)}</SelectContent></Select>
      <Input className="h-9 text-xs" value={draft.tg_uid} onChange={e=>setDraft({...draft,tg_uid:e.target.value})} placeholder="TG 用户 ID"/>
      <Input className="h-9 font-mono text-xs" value={draft.wallet_addr} onChange={e=>setDraft({...draft,wallet_addr:e.target.value})} placeholder="A 地址"/>
      <Select value={draft.status} onValueChange={value=>setDraft({...draft,status:value})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{['待激活','已激活','已解绑','管理员禁用'].map((label,index)=><SelectItem key={index} value={String(index)}>{label}</SelectItem>)}</SelectContent></Select>
      <Button size="sm" className="h-9"><Search className="mr-1 size-3.5"/>搜索</Button>
     </form>
     <section className="overflow-hidden rounded-xl bg-card">
      <header className="flex h-11 items-center justify-between border-b px-3"><h2 className="text-sm font-semibold">绑定记录 <span className="font-normal text-muted-foreground">{total} 条</span></h2><Button variant="ghost" size="icon" className="size-8" aria-label="刷新绑定记录" onClick={()=>rowsQuery.refetch()}><RefreshCw className="size-3.5"/></Button></header>
      <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1040px]"><TableHeader><TableRow>{['ID','机器人','TG 用户 ID','A 地址','状态','激活门槛','激活时间','绑定时间','解绑时间','解绑原因','操作'].map(label=><TableHead key={label} className="h-9 px-3 text-xs">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
       {rowsQuery.isPending?<TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>:records.length?records.map(raw=>{const row=raw as Binding;return <TableRow key={row.rid}>
        <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs">{botName(row)}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.tg_uid}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[10px]" title={row.wallet_addr}>{row.wallet_addr}</TableCell><TableCell className="px-3 py-2"><Badge variant="outline" className={'text-[10px] '+statusTone(row.status)}>{row.status_label}</Badge></TableCell><TableCell className="px-3 py-2 text-xs">{row.activate_threshold} TRX</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.activate_time)}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.create_time)}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.unbind_time)}</TableCell><TableCell className="max-w-36 truncate px-3 py-2 text-xs" title={row.unbind_reason||''}>{fallback(row.unbind_reason)}</TableCell>
        <TableCell className="px-3 py-2"><div className="flex gap-1">{rowsQuery.data?.canActivate&&row.status===0&&<Button size="sm" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'activate',row})}><Check className="mr-1 size-3"/>激活</Button>}{rowsQuery.data?.canUnbind&&[0,1].includes(row.status)&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" onClick={()=>{setUnbindReason('管理员解绑');setIntent({kind:'unbind',row})}}><X className="mr-1 size-3"/>解绑</Button>}</div></TableCell>
       </TableRow>}):<TableRow><TableCell colSpan={11} className="h-20 text-center text-xs text-muted-foreground">暂无绑定记录</TableCell></TableRow>}
      </TableBody></Table></div><div className="divide-y md:hidden">{rowsQuery.isPending?<p className="py-10 text-center text-xs text-muted-foreground">加载中…</p>:records.length?records.map(raw=>{const row=raw as Binding;return <article key={row.rid} className="space-y-3 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold">#{row.rid} · {botName(row)}</p><p className="text-xs text-muted-foreground">TG 用户 {row.tg_uid}</p></div><Badge variant="outline" className={'shrink-0 text-[10px] '+statusTone(row.status)}>{row.status_label}</Badge></div><p className="break-all font-mono text-[10px]">{row.wallet_addr}</p><dl className="grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-muted-foreground">激活门槛</dt><dd>{row.activate_threshold} TRX</dd></div><div><dt className="text-muted-foreground">绑定时间</dt><dd>{fallback(row.create_time)}</dd></div><div><dt className="text-muted-foreground">激活时间</dt><dd>{fallback(row.activate_time)}</dd></div><div><dt className="text-muted-foreground">解绑时间</dt><dd>{fallback(row.unbind_time)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">解绑原因</dt><dd>{fallback(row.unbind_reason)}</dd></div></dl><div className="flex gap-1">{rowsQuery.data?.canActivate&&row.status===0&&<Button size="sm" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'activate',row})}><Check className="mr-1 size-3"/>激活</Button>}{rowsQuery.data?.canUnbind&&[0,1].includes(row.status)&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" onClick={()=>{setUnbindReason('管理员解绑');setIntent({kind:'unbind',row})}}><X className="mr-1 size-3"/>解绑</Button>}</div></article>}):<p className="py-10 text-center text-xs text-muted-foreground">暂无绑定记录</p>}</div>{tableFooter}
     </section>
    </TabsContent>
    <TabsContent value="grants" className="mt-0 space-y-3">
     <form onSubmit={applyFilters} className="grid gap-2 rounded-xl bg-card p-3 sm:grid-cols-2 lg:grid-cols-7">
      <Select value={draft.bot_rid} onValueChange={value=>setDraft({...draft,bot_rid:value})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部机器人</SelectItem>{bots.map(bot=><SelectItem key={bot.rid} value={String(bot.rid)}>{displayBot(bot)}</SelectItem>)}</SelectContent></Select>
      <Input className="h-9 font-mono text-xs" value={draft.a_addr} onChange={e=>setDraft({...draft,a_addr:e.target.value})} placeholder="A 地址"/>
      <Input className="h-9 font-mono text-xs" value={draft.n_addr} onChange={e=>setDraft({...draft,n_addr:e.target.value})} placeholder="N 地址"/>
      <Input className="h-9 font-mono text-xs" value={draft.tx_hash} onChange={e=>setDraft({...draft,tx_hash:e.target.value})} placeholder="TxHash"/>
      <Select value={draft.status} onValueChange={value=>setDraft({...draft,status:value})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{['处理中','成功','失败','转人工'].map((label,index)=><SelectItem key={index} value={String(index)}>{label}</SelectItem>)}</SelectContent></Select>
      <div className="flex items-center gap-1"><Input type="date" aria-label="开始日期" className="h-9 min-w-0 text-xs" value={draft.date_start} onChange={e=>setDraft({...draft,date_start:e.target.value})}/><span className="text-muted-foreground">—</span><Input type="date" aria-label="结束日期" className="h-9 min-w-0 text-xs" value={draft.date_end} onChange={e=>setDraft({...draft,date_end:e.target.value})}/></div>
      <Button size="sm" className="h-9"><Search className="mr-1 size-3.5"/>搜索</Button>
     </form>
     <section className="overflow-hidden rounded-xl bg-card">
      <header className="flex h-11 items-center justify-between border-b px-3"><h2 className="text-sm font-semibold">发放记录 <span className="font-normal text-muted-foreground">{total} 条</span></h2><Button variant="ghost" size="icon" className="size-8" aria-label="刷新发放记录" onClick={()=>rowsQuery.refetch()}><RefreshCw className="size-3.5"/></Button></header>
      <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1180px]"><TableHeader><TableRow>{['ID','机器人','TG 用户 ID','A 地址','N 地址','触发 TxHash','发放能量','发放状态','审核状态','重试次数','失败原因','发放时间','操作'].map(label=><TableHead key={label} className="h-9 px-3 text-xs">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
       {rowsQuery.isPending?<TableRow><TableCell colSpan={13} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>:records.length?records.map(raw=>{const row=raw as Grant;return <TableRow key={row.rid}>
        <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs">{botName(row)}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.tg_uid}</TableCell><TableCell className="max-w-40 truncate px-3 py-2 font-mono text-[10px]" title={row.a_addr}>{row.a_addr}</TableCell><TableCell className="max-w-40 truncate px-3 py-2 font-mono text-[10px]" title={row.n_addr}>{row.n_addr}</TableCell><TableCell className="max-w-44 truncate px-3 py-2 font-mono text-[10px]" title={row.tx_hash}>{row.tx_hash}</TableCell><TableCell className="px-3 py-2 text-xs">{formatLocaleNumber(row.energy_amount)}</TableCell><TableCell className="px-3 py-2"><Badge variant="outline" className={'text-[10px] '+grantTone(row.grant_status)}>{row.grant_status_label}</Badge></TableCell><TableCell className="px-3 py-2 text-xs">{auditLabel(row.audit_status)}</TableCell><TableCell className="px-3 py-2 text-xs">{row.retry_count}</TableCell><TableCell className="max-w-40 truncate px-3 py-2 text-xs" title={row.fail_reason||''}>{fallback(row.fail_reason)}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.grant_time)}</TableCell><TableCell className="px-3 py-2"><div className="flex gap-1">{rowsQuery.data?.canReview&&row.audit_status===1&&<><Button size="sm" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'approve',row})}>通过</Button><Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" onClick={()=>setIntent({kind:'reject',row})}>拒绝</Button></>}{rowsQuery.data?.canRetry&&row.grant_status===2&&[0,2].includes(row.audit_status)&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'retry',row})}>重试</Button>}</div></TableCell>
       </TableRow>}):<TableRow><TableCell colSpan={13} className="h-20 text-center text-xs text-muted-foreground">暂无发放记录</TableCell></TableRow>}
      </TableBody></Table></div><div className="divide-y md:hidden">{rowsQuery.isPending?<p className="py-10 text-center text-xs text-muted-foreground">加载中…</p>:records.length?records.map(raw=>{const row=raw as Grant;return <article key={row.rid} className="space-y-3 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold">#{row.rid} · {botName(row)}</p><p className="text-xs text-muted-foreground">TG 用户 {row.tg_uid}</p></div><Badge variant="outline" className={'shrink-0 text-[10px] '+grantTone(row.grant_status)}>{row.grant_status_label}</Badge></div><dl className="grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-muted-foreground">发放能量</dt><dd>{formatLocaleNumber(row.energy_amount)}</dd></div><div><dt className="text-muted-foreground">审核状态</dt><dd>{auditLabel(row.audit_status)}</dd></div><div><dt className="text-muted-foreground">重试次数</dt><dd>{row.retry_count}</dd></div><div><dt className="text-muted-foreground">发放时间</dt><dd>{fallback(row.grant_time)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">A 地址</dt><dd className="break-all font-mono text-[10px]">{row.a_addr}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">N 地址</dt><dd className="break-all font-mono text-[10px]">{row.n_addr}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">触发 TxHash</dt><dd className="break-all font-mono text-[10px]">{row.tx_hash}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">失败原因</dt><dd>{fallback(row.fail_reason)}</dd></div></dl>{rowsQuery.data?.canReview&&row.audit_status===1&&<div className="flex gap-1"><Button size="sm" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'approve',row})}>通过</Button><Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" onClick={()=>setIntent({kind:'reject',row})}>拒绝</Button></div>}{rowsQuery.data?.canRetry&&row.grant_status===2&&[0,2].includes(row.audit_status)&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={()=>setIntent({kind:'retry',row})}>重试</Button>}</article>}):<p className="py-10 text-center text-xs text-muted-foreground">暂无发放记录</p>}</div>{tableFooter}
     </section>
    </TabsContent>
   </Tabs>
  </main>
  <Dialog open={!!intent} onOpenChange={open=>{if(!open){setIntent(null);mutation.reset()}}}>
   <DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-sm">{intent?.kind==='activate'?'激活这条绑定？':intent?.kind==='unbind'?'解绑这条记录？':intent?.kind==='approve'?'通过审核并发放？':intent?.kind==='reject'?'拒绝这次发放？':'重新提交发放任务？'}</DialogTitle></DialogHeader>
    <div className="space-y-3 text-xs">
     {intent?.kind==='retry'||intent?.kind==='approve'?<div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0"/><p>job 处理后可能向 N 地址发放能量，并消耗所选能量实例的钱包余额。</p></div>:<p className="truncate font-mono">{intentDetails}</p>}
     {intent?.kind==='unbind'&&<label className="grid gap-1.5"><span className="text-muted-foreground">解绑原因</span><Input maxLength={500} value={unbindReason} onChange={e=>setUnbindReason(e.target.value)} className="h-9 text-xs"/></label>}
     {error&&<p role="alert" className="text-destructive">{error}</p>}
    </div>
    <DialogFooter><Button size="sm" variant="outline" onClick={()=>setIntent(null)}>取消</Button><Button size="sm" variant={intent?.kind==='unbind'||intent?.kind==='reject'?'destructive':'default'} disabled={mutation.isPending||!intent} onClick={confirmIntent}>{mutation.isPending?'处理中…':'确认'}</Button></DialogFooter>
   </DialogContent>
  </Dialog>
 </AdminShell>
}
