import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'

type Row = { rid:number; tx_hash:string; transferfrom_address:string; transferto_address:string; coin_name:string; amount:string; sendback_coin_name:string|null; sendback_amount:string; timestamp:string; get_time:string|null; process_status:number; process_status_label:string; process_time:string|null; process_comments:string|null; sendback_time:string|null; can_reissue:boolean; can_stop:boolean }
type Data = { rows:Row[]; total:number; page:number; pageSize:number; canReissue:boolean; canStop:boolean; canDelete:boolean }
type Filters = { tx_hash:string; transferfrom_address:string; transferto_address:string }
type Intent = {action:'reswap'|'stopswap'; row:Row} | {action:'batch_delete'; ids:number[]} | null
const empty:Filters={tx_hash:'',transferfrom_address:'',transferto_address:''}
const fallback=(value:string|null|undefined)=>value||'—'
export const Route=createFileRoute('/console/transit-trades')({component:Page})

function Page(){
 const qc=useQueryClient()
 const me=useQuery({queryKey:['me'],queryFn:()=>api<AdminUser>('/api/me'),retry:false,staleTime:60_000})
 const logout=useMutation({mutationFn:()=>api('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),onSuccess:()=>{qc.clear();window.location.assign('/console/home')}})
 const [draft,setDraft]=useState(empty),[filter,setFilter]=useState(empty),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(15),[selected,setSelected]=useState<number[]>([]),[intent,setIntent]=useState<Intent>(null),[feedback,setFeedback]=useState('')
 const query=useQuery({queryKey:['transit-trades',page,pageSize,filter],queryFn:()=>api<Data>('/api/transit-trades?'+new URLSearchParams({page:String(page),pageSize:String(pageSize),...filter})),enabled:!!me.data,retry:false})
 const mutation=useMutation({mutationFn:(body:Exclude<Intent,null>)=>api<{message:string}>('/api/transit-trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),onSuccess:async result=>{setIntent(null);setSelected([]);setFeedback(result.message);await qc.invalidateQueries({queryKey:['transit-trades']})}})
 if(me.isPending)return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="加载中"/></div>
 if(!me.data)return <main className="grid min-h-screen place-items-center p-4"><section className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4"/>TG Ultra</div><h1 className="text-base font-semibold">登录管理后台</h1><Button asChild className="w-full"><a href="/api/auth/start?destination=transitTrades"><KeyRound className="size-4"/>管理员登录</a></Button></section></main>
 const rows=query.data?.rows||[],total=query.data?.total||0,pages=Math.max(1,Math.ceil(total/pageSize))
 const toggle=(rid:number,checked:boolean)=>setSelected(current=>checked?[...new Set([...current,rid])]:current.filter(id=>id!==rid))
 const all=rows.length>0&&rows.every(row=>selected.includes(row.rid))
 const actions=(row:Row)=><div className="flex gap-1.5">
  {query.data?.canReissue&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!row.can_reissue||mutation.isPending} onClick={()=>{mutation.reset();setIntent({action:'reswap',row})}}><RefreshCw className="mr-1 size-3"/>补发</Button>}
  {query.data?.canStop&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" disabled={!row.can_stop||mutation.isPending} onClick={()=>{mutation.reset();setIntent({action:'stopswap',row})}}><Ban className="mr-1 size-3"/>禁止</Button>}
 </div>
 return <AdminShell user={me.data} title="闪兑交易" activeRoute="admin.transit.trade.index" onRefresh={()=>query.refetch()} onLogout={()=>logout.mutate()}>
 <main className="space-y-3 p-3 sm:p-4">
  <form className="flex flex-wrap gap-2 rounded-xl bg-card p-3" onSubmit={e=>{e.preventDefault();setFilter(draft);setPage(1);setSelected([])}}>
   <Input className="h-9 min-w-40 flex-1 text-xs" placeholder="交易 Hash" maxLength={100} value={draft.tx_hash} onChange={e=>setDraft({...draft,tx_hash:e.target.value})}/>
   <Input className="h-9 min-w-40 flex-1 text-xs" placeholder="发送钱包地址" maxLength={200} value={draft.transferfrom_address} onChange={e=>setDraft({...draft,transferfrom_address:e.target.value})}/>
   <Input className="h-9 min-w-40 flex-1 text-xs" placeholder="接收钱包地址" maxLength={200} value={draft.transferto_address} onChange={e=>setDraft({...draft,transferto_address:e.target.value})}/>
   <Button size="sm" className="h-9"><Search className="mr-1 size-3.5"/>搜索</Button>
   <Button type="button" variant="outline" size="icon" className="size-9" aria-label="刷新" onClick={()=>query.refetch()}><RefreshCw className="size-3.5"/></Button>
  </form>
  {feedback&&<div role="status" className="flex justify-between rounded-lg border bg-card px-3 py-2 text-xs">{feedback}<button onClick={()=>setFeedback('')}>关闭</button></div>}
  {query.error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive">{query.error instanceof ApiError?query.error.message:'加载失败，请重试'}</div>}
  <section className="overflow-hidden rounded-xl bg-card">
   <header className="flex min-h-11 items-center justify-between gap-2 border-b px-3 py-2"><h1 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-muted-foreground"/>闪兑交易 <span className="font-normal text-muted-foreground">{total} 条</span></h1>{query.data?.canDelete&&<Button variant="outline" size="sm" className="h-8 text-xs" disabled={!selected.length} onClick={()=>setIntent({action:'batch_delete',ids:selected})}><Trash2 className="mr-1 size-3.5"/>删除所选 {selected.length||''}</Button>}</header>
   <div className="hidden overflow-x-auto md:block"><Table className="min-w-[1640px]"><TableHeader><TableRow><TableHead className="w-10 px-3"><Checkbox checked={all?true:selected.length>0&&rows.some(r=>selected.includes(r.rid))?'indeterminate':false} aria-label="选择当前页" onCheckedChange={v=>setSelected(v?[...new Set([...selected,...rows.map(r=>r.rid)])]:selected.filter(id=>!rows.some(r=>r.rid===id)))}/></TableHead>{['ID','交易 Hash','发送钱包地址','接收钱包地址','转入币名','转入数额','回款币名','回款数额','交易时间','拉取时间','处理状态','处理时间','处理备注','出款时间','操作'].map(s=><TableHead key={s} className="h-9 px-3 text-xs">{s}</TableHead>)}</TableRow></TableHeader><TableBody>
    {query.isPending?<TableRow><TableCell colSpan={15} className="h-20 text-center text-xs text-muted-foreground">加载中…</TableCell></TableRow>:rows.length?rows.map(r=><TableRow key={r.rid}>
     <TableCell className="px-3"><Checkbox checked={selected.includes(r.rid)} aria-label={'选择交易 '+r.rid} onCheckedChange={v=>toggle(r.rid,!!v)}/></TableCell><TableCell className="px-3 py-2 font-mono text-xs">#{r.rid}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[10px]" title={r.tx_hash}>{r.tx_hash}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[10px]" title={r.transferfrom_address}>{r.transferfrom_address}</TableCell><TableCell className="max-w-48 truncate px-3 py-2 font-mono text-[10px]" title={r.transferto_address}>{r.transferto_address}</TableCell><TableCell className="px-3 py-2 text-xs">{r.coin_name}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{r.amount}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(r.sendback_coin_name)}</TableCell><TableCell className="px-3 py-2 font-mono text-xs">{r.sendback_amount}</TableCell><TableCell className="px-3 py-2 text-xs">{r.timestamp}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(r.get_time)}</TableCell><TableCell className="px-3 py-2 text-xs">{r.process_status_label}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(r.process_time)}</TableCell><TableCell className="max-w-44 truncate px-3 py-2 text-xs">{fallback(r.process_comments)}</TableCell><TableCell className="px-3 py-2 text-xs">{fallback(r.sendback_time)}</TableCell><TableCell className="px-3 py-2">{actions(r)}</TableCell>
    </TableRow>):<TableRow><TableCell colSpan={15} className="h-20 text-center text-xs text-muted-foreground">暂无记录</TableCell></TableRow>}
   </TableBody></Table></div>
   <div className="divide-y md:hidden">{query.isPending?<p className="py-10 text-center text-xs text-muted-foreground">加载中…</p>:rows.length?rows.map(r=><article key={r.rid} className="space-y-3 p-3">
    <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Checkbox checked={selected.includes(r.rid)} aria-label={'选择交易 '+r.rid} onCheckedChange={v=>toggle(r.rid,!!v)}/><div className="min-w-0"><p className="text-xs font-semibold">#{r.rid} · {r.coin_name} {r.amount}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{r.tx_hash}</p></div></div><span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px]">{r.process_status_label}</span></div>
    <dl className="grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-muted-foreground">发送钱包</dt><dd className="truncate font-mono">{r.transferfrom_address}</dd></div><div><dt className="text-muted-foreground">接收钱包</dt><dd className="truncate font-mono">{r.transferto_address}</dd></div><div><dt className="text-muted-foreground">交易时间</dt><dd>{r.timestamp}</dd></div><div><dt className="text-muted-foreground">拉取时间</dt><dd>{fallback(r.get_time)}</dd></div><div><dt className="text-muted-foreground">回款</dt><dd>{fallback(r.sendback_coin_name)} {r.sendback_amount}</dd></div><div><dt className="text-muted-foreground">出款时间</dt><dd>{fallback(r.sendback_time)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">处理</dt><dd>{fallback(r.process_time)} · {fallback(r.process_comments)}</dd></div></dl>{actions(r)}
   </article>):<p className="py-10 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
   <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"><span className="text-xs text-muted-foreground">第 {page} / {pages} 页</span><div className="flex items-center gap-1.5"><Select value={String(pageSize)} onValueChange={v=>{setPageSize(Number(v));setPage(1);setSelected([])}}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue/></SelectTrigger><SelectContent>{[10,15,20,30,50,100].map(n=><SelectItem key={n} value={String(n)} className="text-xs">{n} 条/页</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="size-8" aria-label="上一页" disabled={page<=1||query.isFetching} onClick={()=>{setPage(p=>p-1);setSelected([])}}><ChevronLeft className="size-3.5"/></Button><Button variant="outline" size="icon" className="size-8" aria-label="下一页" disabled={page>=pages||query.isFetching} onClick={()=>{setPage(p=>p+1);setSelected([])}}><ChevronRight className="size-3.5"/></Button></div></footer>
  </section>
 </main>
 <Dialog open={!!intent} onOpenChange={open=>{if(!open){setIntent(null);mutation.reset()}}}><DialogContent aria-describedby={undefined} className="max-w-md gap-4"><DialogHeader><DialogTitle className="text-base">{intent?.action==='reswap'?'确认补发闪兑':intent?.action==='stopswap'?'确认禁止兑换':'确认批量删除'}</DialogTitle></DialogHeader>
  {intent?.action==='batch_delete'?<p className="text-sm text-muted-foreground">将永久删除所选的 {intent.ids.length} 条闪兑记录。</p>:intent?.row&&<div className="space-y-1 rounded-lg bg-muted px-3 py-2 text-xs"><p>交易 #{intent.row.rid} · {intent.row.coin_name} {intent.row.amount}</p><p className="truncate font-mono text-[10px]">{intent.row.tx_hash}</p><p>当前状态：{intent.row.process_status_label}</p><p className="pt-1 text-muted-foreground">{intent.action==='reswap'?'交易将重新放入闪兑处理队列。':'交易将标记为人工禁止兑换。'}</p></div>}
  {mutation.error&&<p role="alert" className="text-xs text-destructive">{mutation.error instanceof ApiError?mutation.error.message:'操作失败，请重试'}</p>}<DialogFooter><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={()=>setIntent(null)}>取消</Button><Button size="sm" variant={intent?.action==='stopswap'||intent?.action==='batch_delete'?'destructive':'default'} disabled={mutation.isPending||!intent} onClick={()=>intent&&mutation.mutate(intent)}>{mutation.isPending?'处理中…':'确认'}</Button></DialogFooter>
 </DialogContent></Dialog>
 </AdminShell>
}
