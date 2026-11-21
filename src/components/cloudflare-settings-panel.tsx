import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { api, ApiError } from "@/lib/api"

type CloudflareConfig={domainEnabled:boolean;hostname:string;turnstileEnabled:boolean;turnstileSiteKey:string;turnstileSecret:string;turnstileSecretConfigured:boolean}
const empty:CloudflareConfig={domainEnabled:false,hostname:"",turnstileEnabled:false,turnstileSiteKey:"",turnstileSecret:"",turnstileSecretConfigured:false}
export function CloudflareSettingsPanel(){
 const client=useQueryClient(),[form,setForm]=useState(empty),[notice,setNotice]=useState("")
 const query=useQuery({queryKey:["cloudflare-security"],queryFn:()=>api<CloudflareConfig>("/api/cloudflare-security"),retry:false})
 useEffect(()=>{if(query.data)setForm(query.data)},[query.data])
 const save=useMutation({mutationFn:(v:CloudflareConfig)=>api<{message:string}>("/api/cloudflare-security",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({domainEnabled:v.domainEnabled,hostname:v.hostname,turnstileEnabled:v.turnstileEnabled,turnstileSiteKey:v.turnstileSiteKey,turnstileSecret:v.turnstileSecret})}),onSuccess:async r=>{setNotice(r.message);await client.invalidateQueries({queryKey:["cloudflare-security"]})},onError:e=>setNotice(e instanceof ApiError?e.message:"配置保存失败")})
 const update=(patch:Partial<CloudflareConfig>)=>setForm(v=>({...v,...patch}))
 const persist=(v=form)=>{setNotice("");save.mutate(v)}
 const field=(label:string,key:"hostname"|"turnstileSiteKey"|"turnstileSecret",placeholder:string,type="text")=><label className="block space-y-1.5 text-xs"><span>{label}</span><Input type={type} value={form[key]} placeholder={placeholder} autoComplete="off" onChange={e=>update({[key]:e.target.value})} onBlur={()=>{if(form[key]!==query.data?.[key])persist()}} /></label>
 const cards=[
  {id:"domain",title:"域名唯一性",description:"仅允许指定的后台域名访问。",checked:form.domainEnabled,toggle:(checked:boolean)=>{update({domainEnabled:checked});persist({...form,domainEnabled:checked})},body:<div className="grid gap-3 sm:grid-cols-2">{field("后台域名","hostname","admin.example.com")}<p className="self-end text-xs text-muted-foreground">仅这个 Host 可以访问管理页面和 API。</p></div>},
  {id:"turnstile",title:"Cloudflare Turnstile",description:"为管理员登录增加 Turnstile 人机验证。",checked:form.turnstileEnabled,toggle:(checked:boolean)=>{update({turnstileEnabled:checked});persist({...form,turnstileEnabled:checked})},body:<div className="grid gap-3 sm:grid-cols-2">{field("Site Key","turnstileSiteKey","Turnstile Site Key")}{field("Secret Key","turnstileSecret",form.turnstileSecretConfigured?"已保存；留空保持不变":"Turnstile Secret Key","password")}</div>},
 ] as const
 return <section className="rounded-xl border bg-card p-4">
  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><svg aria-hidden="true" viewBox="0 0 64 40" className="h-5 w-8"><path fill="#f48120" d="M42.8 29.4c.4-1.3.2-2.4-.4-3.2-.6-.7-1.7-1.1-3-1.2l-25.2-.3c-.2 0-.4-.1-.5-.2s-.1-.3-.1-.5c.1-.3.4-.5.7-.5l25.4-.3c3-.1 6.2-2.5 7.3-5.4l1.4-3.7c.1-.2.1-.4 0-.6A15.6 15.6 0 0 0 18 10.5a7 7 0 0 0-10.8 6.6c0 .4.1.8.2 1.2A10 10 0 0 0 1 27.7c0 .5 0 1 .1 1.5 0 .3.3.5.6.5h40.5c.3 0 .5-.1.6-.3z"/><path fill="#faad3f" d="M50.1 15.2h-.7c-.2 0-.4.2-.5.4l-1 3.4c-.4 1.4-.3 2.5.4 3.3.6.7 1.6 1.1 2.9 1.2l5.4.3c.2 0 .4.1.5.2s.1.3 0 .5c-.1.3-.4.5-.7.5l-5.6.3c-3 .1-6.2 2.5-7.3 5.4l-.4 1c-.1.2 0 .4.3.4h18.4c.3 0 .5-.2.5-.4.2-.8.3-1.7.3-2.6 0-7.6-5.6-13.9-12.5-13.9z"/></svg>Cloudflare</h2>
  <div className="grid gap-3">{cards.map(item=><article key={item.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></div><Switch checked={item.checked} onCheckedChange={item.toggle} aria-label={item.title}/></div>{item.checked&&<div className="mt-3 border-t pt-3">{item.body}</div>}</article>)}</div>
  {notice&&<p role={save.isError?"alert":"status"} className={"mt-3 text-xs "+(save.isError?"text-destructive":"text-muted-foreground")}>{notice}</p>}
  {query.isPending&&<p className="mt-2 text-xs text-muted-foreground">正在读取 Cloudflare 配置…</p>}
  {query.isError&&<p role="alert" className="mt-2 text-xs text-destructive">Cloudflare 配置读取失败</p>}
 </section>
}
