import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'

type Bot={rid:number;bot_username:string|null;bot_firstname:string|null;is_open_bishu:boolean}
type Row={rid:number;bot_rid:number;bot_username:string|null;bot_firstname:string|null;tg_uid:string;wallet_addr:string;status:number;status_label:string;is_buy:string;is_buy_label:string;current_bandwidth_quantity:string;current_energy_quantity:string;total_buy_energy_quantity:string;total_buy_quantity:number;max_buy_quantity:number;total_buy_usdt:string;bishu_stop_day:number;create_time:string|null;back_comments:string|null;comments:string|null;package_open:boolean}
type Data={rows:Row[];bots:Bot[];total:number;page:number;pageSize:number;canAdd:boolean;canEdit:boolean;canDelete:boolean;canRefresh:boolean}
type Filters={bot_rid:string;tg_uid:string;wallet_addr:string}
type Form={bot_rid:string;tg_uid:string;wallet_addr:string;total_buy_usdt:string;max_buy_quantity:string;total_buy_quantity:string;bishu_stop_day:string;back_comments:string;status:string}
type Intent={action:'delete'|'refresh';row:Row}|null
const emptyFilters:Filters={bot_rid:'',tg_uid:'',wallet_addr:''}
const emptyForm:Form={bot_rid:'',tg_uid:'',wallet_addr:'',total_buy_usdt:'0',max_buy_quantity:'0',total_buy_quantity:'0',bishu_stop_day:'0',back_comments:'',status:'0'}
const fallback=(value:string|null|undefined)=>value||'—'
export const Route=createFileRoute('/console/energy-ai-bishu')({component:Page})

function Page(){
 const qc=useQueryClient()
 const me=useQuery({queryKey:['me'],queryFn:()=>api<AdminUser>('/api/me'),retry:false,staleTime:60_000})
 const logout=useMutation({mutationFn:()=>api('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),onSuccess:()=>{qc.clear();window.location.assign('/console/home')}})
 const [draft,setDraft]=useState(emptyFilters),[filter,setFilter]=useState(emptyFilters),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(15)
 const [editor,setEditor]=useState<'create'|Row|null>(null),[form,setForm]=useState(emptyForm),[intent,setIntent]=useState<Intent>(null),[feedback,setFeedback]=useState('')
 const query=useQuery({queryKey:['energy-ai-bishu',page,pageSize,filter],queryFn:()=>api<Data>('/api/energy-ai-bishu?'+new URLSearchParams({page:String(page),pageSize:String(pageSize),...filter})),enabled:!!me.data,retry:false})
 const mutation=useMutation({mutationFn:(body:Record<string,unknown>)=>api<{message:string}>('/api/energy-ai-bishu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),onSuccess:async result=>{setEditor(null);setIntent(null);setFeedback(result.message);await qc.invalidateQueries({queryKey:['energy-ai-bishu']})}})
 if(me.isPending)return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="加载中"/></div>
 if(!me.data)return <main className="grid min-h-screen place-items-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4"/>TGBotPress</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=energyAiBishu"><KeyRound className="size-4"/>管理员登录</a></Button></section></main>
 const rows=query.data?.rows||[],bots=query.data?.bots||[],total=query.data?.total||0,pages=Math.max(1,Math.ceil(total/pageSize))
 const openCreate=()=>{mutation.reset();setForm(emptyForm);setEditor('create')}
 const openEdit=(row:Row)=>{mutation.reset();setForm({bot_rid:String(row.bot_rid),tg_uid:row.tg_uid||'',wallet_addr:row.wallet_addr,total_buy_usdt:row.total_buy_usdt,max_buy_quantity:String(row.max_buy_quantity),total_buy_quantity:String(row.total_buy_quantity),bishu_stop_day:String(row.bishu_stop_day),back_comments:row.back_comments||'',status:String(row.status)});setEditor(row)}
 const submit=(event:FormEvent)=>{event.preventDefault();mutation.mutate(editor==='create'?{action:'add',...form,bot_rid:Number(form.bot_rid),max_buy_quantity:Number(form.max_buy_quantity),total_buy_quantity:Number(form.total_buy_quantity),bishu_stop_day:Number(form.bishu_stop_day)}:{action:'update',rid:editor?.rid,bot_rid:Number(form.bot_rid),tg_uid:form.tg_uid,wallet_addr:form.wallet_addr,status:Number(form.status),max_buy_quantity:Number(form.max_buy_quantity),total_buy_quantity:Number(form.total_buy_quantity),bishu_stop_day:Number(form.bishu_stop_day),back_comments:form.back_comments})}
 const runIntent=()=>{if(!intent)return;mutation.mutate({action:intent.action,rid:intent.row.rid})}
 const botName=(row:Row)=>row.bot_username?('@'+row.bot_username):row.bot_firstname||('机器人 #'+row.bot_rid)
 const statusClass=(s:number)=>s===0?'bg-emerald-50 text-emerald-700':s===2?'bg-red-50 text-red-700':'bg-muted text-muted-foreground'
 const rowActions=(row:Row)=><div className="flex flex-wrap gap-1.5">
  {query.data?.canEdit&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={()=>openEdit(row)}><Pencil className="mr-1 size-3"/>编辑</Button>}
  {query.data?.canRefresh&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={()=>{mutation.reset();setIntent({action:'refresh',row})}}><RefreshCw className="mr-1 size-3"/>刷新</Button>}
  {query.data?.canDelete&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" onClick={()=>{mutation.reset();setIntent({action:'delete',row})}}><Trash2 className="mr-1 size-3"/>删除</Button>}
 </div>
 const editorFields=<>
  <label className="space-y-1 text-xs"><span>机器人</span><Select value={form.bot_rid} onValueChange={value=>setForm({...form,bot_rid:value})}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="选择机器人"/></SelectTrigger><SelectContent>{bots.map(bot=><SelectItem key={bot.rid} value={String(bot.rid)} className="text-xs">{bot.bot_username?'@'+bot.bot_username:bot.bot_firstname||('机器人 #'+bot.rid)}{bot.is_open_bishu?' · 笔数套餐已开':' · 笔数套餐未开'}</SelectItem>)}</SelectContent></Select></label>
  <label className="space-y-1 text-xs"><span>TG 用户 ID</span><Input value={form.tg_uid} maxLength={100} onChange={e=>setForm({...form,tg_uid:e.target.value})} className="h-9 text-xs" placeholder="可填写多个 ID，以逗号分隔"/></label>
  <label className="space-y-1 text-xs"><span>TRON 地址</span><Input value={form.wallet_addr} maxLength={34} onChange={e=>setForm({...form,wallet_addr:e.target.value.trim()})} className="h-9 font-mono text-xs" placeholder="T 开头，34 位"/></label>
  {editor==='create'&&<label className="space-y-1 text-xs"><span>总购买 USDT</span><Input value={form.total_buy_usdt} inputMode="decimal" onChange={e=>setForm({...form,total_buy_usdt:e.target.value})} className="h-9 text-xs"/></label>}
  <label className="space-y-1 text-xs"><span>最大购买次数</span><Input type="number" min="0" step="1" value={form.max_buy_quantity} onChange={e=>setForm({...form,max_buy_quantity:e.target.value})} className="h-9 text-xs"/></label>
  <label className="space-y-1 text-xs"><span>已购买次数</span><Input type="number" min="0" step="1" value={form.total_buy_quantity} onChange={e=>setForm({...form,total_buy_quantity:e.target.value})} className="h-9 text-xs"/></label>
  <label className="space-y-1 text-xs"><span>滞留暂停天数（0 为不限）</span><Input type="number" min="0" step="1" value={form.bishu_stop_day} onChange={e=>setForm({...form,bishu_stop_day:e.target.value})} className="h-9 text-xs"/></label>
  {editor!=='create'&&<label className="space-y-1 text-xs"><span>状态</span><Select value={form.status} onValueChange={value=>setForm({...form,status:value})}><SelectTrigger className="h-9 text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="0">开启</SelectItem><SelectItem value="1">关闭</SelectItem><SelectItem value="2">管理员关闭</SelectItem></SelectContent></Select></label>}
  <label className="space-y-1 text-xs sm:col-span-2"><span>后台备注</span><Input value={form.back_comments} maxLength={2000} onChange={e=>setForm({...form,back_comments:e.target.value})} className="h-9 text-xs"/></label>
 </>
 return <AdminShell user={me.data} title="笔数能量" activeRoute="admin.energy.aibishu.index" onRefresh={()=>query.refetch()} onLogout={()=>logout.mutate()}>
 <main className="space-y-3 p-3 sm:p-4">
  <form className="flex flex-wrap gap-2 rounded-xl bg-card p-3" onSubmit={e=>{e.preventDefault();setFilter(draft);setPage(1)}}>
   <Select value={draft.bot_rid||'all'} onValueChange={value=>setDraft({...draft,bot_rid:value==='all'?'':value})}><SelectTrigger className="h-9 w-52 text-xs"><SelectValue placeholder="全部机器人"/></SelectTrigger><SelectContent><SelectItem value="all">全部机器人</SelectItem>{bots.map(bot=><SelectItem key={bot.rid} value={String(bot.rid)} className="text-xs">{bot.bot_username?'@'+bot.bot_username:bot.bot_firstname||('机器人 #'+bot.rid)}</SelectItem>)}</SelectContent></Select>
   <Input className="h-9 min-w-36 flex-1 text-xs" value={draft.tg_uid} placeholder="TG 用户 ID" onChange={e=>setDraft({...draft,tg_uid:e.target.value})}/>
   <Input className="h-9 min-w-40 flex-1 font-mono text-xs" value={draft.wallet_addr} placeholder="钱包地址" onChange={e=>setDraft({...draft,wallet_addr:e.target.value})}/>
   <Button size="sm" className="h-9"><Search className="mr-1 size-3.5"/>搜索</Button><Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新列表" onClick={()=>query.refetch()}><RefreshCw className="size-3.5"/></Button>
   {query.data?.canAdd&&<Button type="button" size="sm" className="h-9" onClick={openCreate}><Plus className="mr-1 size-3.5"/>添加地址笔数</Button>}
  </form>
  {feedback&&<div role="status" className="flex justify-between rounded-lg border bg-card px-3 py-2 text-xs">{feedback}<button onClick={()=>setFeedback('')}>关闭</button></div>}
  {query.error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive">{query.error instanceof ApiError?query.error.message:'加载失败，请重试'}</div>}
  <section className="overflow-hidden rounded-xl bg-card">
   <header className="flex min-h-11 items-center justify-between border-b px-3 py-2"><h1 className="text-sm font-semibold">笔数地址 <span className="font-normal text-muted-foreground">{total} 条</span></h1></header>
   <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1780px]"><TableHeader><TableRow>{['ID','机器人','TG 用户 ID','地址','状态','下单状态','当前带宽','当前能量','总购买能量','已购买次数','最大次数','总转入 USDT','滞留暂停天数','创建时间','后台备注','备注','操作'].map(x=><TableHead key={x} className="h-9 px-3 text-xs">{x}</TableHead>)}</TableRow></TableHeader><TableBody>
    {query.isPending?<TableRow><TableCell colSpan={17} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>:rows.length?rows.map(row=><TableRow key={row.rid}>
     <TableCell className="px-3 py-2 font-mono text-xs">#{row.rid}</TableCell><TableCell className="px-3 py-2 text-xs">{botName(row)}{!row.package_open&&<span className="ml-1 text-amber-600">套餐未开</span>}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.tg_uid)}</TableCell><TableCell className="max-w-44 truncate px-3 py-2 font-mono text-[10px]" title={row.wallet_addr}>{row.wallet_addr}</TableCell><TableCell className="px-3 py-2"><span className={'rounded-full px-2 py-1 text-[10px] '+statusClass(row.status)}>{row.status_label}</span></TableCell><TableCell className="px-3 py-2 text-xs">{row.is_buy_label}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.current_bandwidth_quantity}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.current_energy_quantity}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{row.total_buy_energy_quantity}</TableCell><TableCell className="px-3 py-2 text-xs">{row.total_buy_quantity}</TableCell><TableCell className="px-3 py-2 text-xs">{row.max_buy_quantity}</TableCell><TableCell className="px-3 py-2 text-xs">{row.total_buy_usdt}</TableCell><TableCell className="px-3 py-2 text-xs">{row.bishu_stop_day}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(row.create_time)}</TableCell><TableCell className="max-w-44 truncate px-3 py-2 text-xs" title={row.back_comments||''}>{fallback(row.back_comments)}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 text-xs" title={row.comments||''}>{fallback(row.comments)}</TableCell><TableCell className="px-3 py-2">{rowActions(row)}</TableCell>
    </TableRow>):<TableRow><TableCell colSpan={17} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}
   </TableBody></Table></div>
   <div className="divide-y md:hidden">{query.isPending?<p className="py-10 text-center text-xs text-muted-foreground">加载中…</p>:rows.length?rows.map(row=><article key={row.rid} className="space-y-3 p-3">
    <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold">#{row.rid} · {botName(row)}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{row.wallet_addr}</p></div><span className={'shrink-0 rounded-full px-2 py-1 text-[10px] '+statusClass(row.status)}>{row.status_label}</span></div>
    <dl className="grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-muted-foreground">TG 用户</dt><dd>{fallback(row.tg_uid)}</dd></div><div><dt className="text-muted-foreground">下单状态</dt><dd>{row.is_buy_label}</dd></div><div><dt className="text-muted-foreground">当前能量</dt><dd>{row.current_energy_quantity}</dd></div><div><dt className="text-muted-foreground">购买次数</dt><dd>{row.total_buy_quantity} / {row.max_buy_quantity}</dd></div><div><dt className="text-muted-foreground">总转入 USDT</dt><dd>{row.total_buy_usdt}</dd></div><div><dt className="text-muted-foreground">滞留暂停天数</dt><dd>{row.bishu_stop_day}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">后台备注</dt><dd>{fallback(row.back_comments)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">备注</dt><dd>{fallback(row.comments)}</dd></div></dl>{rowActions(row)}
   </article>):<p className="py-10 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
   <footer className="flex items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页 · {total} 条</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={v=>{setPageSize(Number(v));setPage(1)}}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue/></SelectTrigger><SelectContent>{[10,15,20,30,50,100].map(n=><SelectItem key={n} value={String(n)} className="text-xs">{n} 条/页</SelectItem>)}</SelectContent></Select><Button size="icon" variant="outline" className="size-8" aria-label="上一页" disabled={page<=1||query.isFetching} onClick={()=>setPage(p=>p-1)}><ChevronLeft className="size-3.5"/></Button><Button size="icon" variant="outline" className="size-8" aria-label="下一页" disabled={page>=pages||query.isFetching} onClick={()=>setPage(p=>p+1)}><ChevronRight className="size-3.5"/></Button></div></footer>
  </section>
 </main>
 <Dialog open={!!editor} onOpenChange={open=>{if(!open){setEditor(null);mutation.reset()}}}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle className="text-base">{editor==='create'?'添加地址笔数':'修改笔数能量'}</DialogTitle></DialogHeader>
  <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">{editorFields}{mutation.error&&<p role="alert" className="text-xs text-destructive sm:col-span-2">{mutation.error instanceof ApiError?mutation.error.message:'保存失败，请重试'}</p>}<DialogFooter className="sm:col-span-2"><Button type="button" size="sm" variant="outline" onClick={()=>setEditor(null)}>取消</Button><Button size="sm" disabled={mutation.isPending||!form.bot_rid}>{mutation.isPending?'保存中…':'保存'}</Button></DialogFooter></form>
 </DialogContent></Dialog>
 <Dialog open={!!intent} onOpenChange={open=>{if(!open){setIntent(null);mutation.reset()}}}><DialogContent aria-describedby={undefined} className="max-w-sm"><DialogHeader><DialogTitle className="text-base">{intent?.action==='delete'?'确认删除地址':'刷新下单状态'}</DialogTitle></DialogHeader><div className="space-y-2 text-xs"><p className="truncate font-mono">{intent?.row.wallet_addr}</p>{intent?.action==='refresh'?<p className="text-amber-700">刷新后 job 会重新检查钱包能量；达到下单条件时可能自动提交代理订单并消耗钱包余额。</p>:<p>删除后无法恢复此地址记录。</p>}{mutation.error&&<p role="alert" className="text-destructive">{mutation.error instanceof ApiError?mutation.error.message:'操作失败，请重试'}</p>}</div><DialogFooter><Button size="sm" variant="outline" onClick={()=>setIntent(null)}>取消</Button><Button size="sm" variant={intent?.action==='delete'?'destructive':'default'} disabled={mutation.isPending||!intent} onClick={runIntent}>{mutation.isPending?'处理中…':'确认'}</Button></DialogFooter></DialogContent></Dialog>
 </AdminShell>
}
