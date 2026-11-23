import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { ChevronDown, LayoutGrid, LogOut, UserRound } from 'lucide-react'

const ETS_ORIGIN = 'https://ets.txsw.top'
export function EtsLoginDialog({onAccessToken}:{onAccessToken?:(token:string)=>void}={}) {
 const [open,setOpen]=useState(false), [error,setError]=useState('')
 const frame=useRef<HTMLIFrameElement>(null), popupRef=useRef<Window | null>(null), queryClient=useQueryClient()
 const binding=useQuery({queryKey:['ets-binding'],queryFn:()=>api<{linked:boolean;name?:string|null;avatar?:string|null}>('/api/ets-binding'),retry:false})
 useEffect(()=>{
  if (!open) return
  const onMessage = async (event: MessageEvent) => {
   const message=event.data
   if (event.origin === window.location.origin && event.source === popupRef.current && message?.type === 'TG_ETS_SOCIAL_CALLBACK' && typeof message.fragment === 'string') {
    const raw = message.fragment.slice(1)
    if (!raw.startsWith('/appstore-expand?')) return
    const params = new URLSearchParams(raw.slice('/appstore-expand?'.length))
    let saved: {nonce?:string;expiresAt?:number} | null = null
    try { saved = JSON.parse(sessionStorage.getItem('ets-login-flow') || 'null') } catch { /* invalid flow */ }
    sessionStorage.removeItem('ets-login-flow'); popupRef.current = null
    const tokenHash = params.get('ets_auth_token'), state = params.get('state'), type = params.get('ets_auth_type')
    if (!tokenHash || tokenHash.length > 2048 || !state || state !== saved?.nonce || !saved.expiresAt || saved.expiresAt < Date.now() || !['magiclink','email'].includes(type ?? '')) { setError('登录回调已过期，请重新登录。'); return }
    frame.current?.contentWindow?.postMessage({type:'DJ_APPSTORE_AUTH_RELAY',tokenHash,otpType:type},ETS_ORIGIN)
    return
   }
   if(event.origin!==ETS_ORIGIN || event.source!==frame.current?.contentWindow) return
   if (!message || typeof message !== 'object') return
   if (message.type === 'DJ_APPSTORE_AUTH_START') {
    try {
     const start = new URL(String(message.url))
     if (start.origin !== ETS_ORIGIN || start.pathname !== '/api/auth/zibll/start') throw new Error('invalid login origin')
     const nonce = crypto.randomUUID()
     sessionStorage.setItem('ets-login-flow', JSON.stringify({ nonce, expiresAt: Date.now() + 600000 }))
     const returnUrl = new URL('/api/ets-callback', window.location.origin)
     returnUrl.hash = `/appstore-expand?state=${encodeURIComponent(nonce)}`
     start.searchParams.set('dj_embed','tgbotpress')
     start.searchParams.set('return_to', returnUrl.toString())
     const popup = window.open(start.toString(), 'ets-social-login', 'popup,width=560,height=720')
     popupRef.current = popup
     if (!popup) setError('浏览器阻止了登录窗口，请允许弹出窗口后重试。')
    } catch { setError('无法打开登录窗口，请重试。') }
    return
   }
   if(message.type!=='DJ_APPSTORE_SESSION' || typeof message.requestId!=='string' || message.requestId.length>100) return
   const reply=(ok:boolean,data:object,error?:string)=>frame.current?.contentWindow?.postMessage({type:'DJ_APPSTORE_SESSION_RESULT',requestId:message.requestId,ok,data,error},ETS_ORIGIN)
   if(message.action==='restore'){reply(true,{linked:false});return}
   if(message.action==='unlink'){
    try { await api('/api/ets-binding',{method:'DELETE'}); reply(true,{cleared:true}); sessionStorage.setItem('tgbotpress-ets-unlinked','1'); queryClient.setQueryData(['ets-binding'],{linked:false}); await queryClient.invalidateQueries({queryKey:['ets-binding']}) }
    catch { reply(false,{},'退出失败，请稍后重试'); setError('解除 ETS 关联失败，请稍后重试。') }
    return
   }
   if(message.action!=='bind' || typeof message.accessToken!=='string' || message.accessToken.length>4096) return
   if (sessionStorage.getItem('tgbotpress-ets-unlinked') === '1') {
    const relink = window.confirm('此 ETS 账号仍在浏览器中登录。是否重新关联到本机 TGBotPress？')
    if (!relink) { reply(false, {}, '已取消关联'); return }
    sessionStorage.removeItem('tgbotpress-ets-unlinked')
   }
   try {
    onAccessToken?.(message.accessToken)
    await api('/api/ets-binding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:message.accessToken})})
    reply(true,{linked:true})
    await queryClient.invalidateQueries({queryKey:['ets-binding']})
    sessionStorage.removeItem('tgbotpress-ets-unlinked')
    setOpen(false);setError('')
   } catch { reply(false,{},'账号关联失败，请稍后重试');setError('账号关联失败，请检查插件平台服务后重试。') }
  }
  window.addEventListener('message',onMessage)
  return ()=>window.removeEventListener('message',onMessage)
 },[open,queryClient,onAccessToken])
 const url=`${ETS_ORIGIN}/admin/login?dj_embed=tgbotpress`, profile=binding.data
 return <><div className="flex items-center gap-2">{profile?.linked ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="h-10 rounded-full bg-muted/70 px-3"><span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-background">{profile.avatar?<img src={profile.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer"/>:<UserRound className="size-4"/>}</span><span className="flex max-w-32 flex-col items-start leading-tight"><span className="max-w-32 truncate text-sm">{profile.name||'ETS 用户'}</span><span className="text-[10px] text-emerald-600">ETS 已关联</span></span><ChevronDown className="size-4 text-muted-foreground"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={()=>{setError('');setOpen(true)}}><LogOut className="size-4"/>重新验证 ETS 登录</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem asChild><a href={`${ETS_ORIGIN}/admin`} target="_blank" rel="noreferrer"><LayoutGrid className="size-4"/>控制台</a></DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem variant="destructive" onSelect={async()=>{try{await api('/api/ets-binding',{method:'DELETE'});sessionStorage.setItem('tgbotpress-ets-unlinked','1');queryClient.setQueryData(['ets-binding'],{linked:false});await queryClient.invalidateQueries({queryKey:['ets-binding']})}catch{setError('解除 ETS 关联失败，请稍后重试。')}}}><LogOut className="size-4"/>解除本机 ETS 关联</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : <Button type="button" onClick={()=>{setError('');setOpen(true)}} className="rounded-full bg-blue-600 px-5 text-white hover:bg-blue-700">登录插件平台</Button>}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex h-[min(85vh,720px)] flex-col gap-2 p-4 sm:max-w-2xl"><DialogHeader className="pr-8"><DialogTitle>登录插件平台</DialogTitle><DialogDescription>使用 ETS 账号登录并关联当前管理员。</DialogDescription></DialogHeader>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<iframe ref={frame} src={url} title="ETS 插件平台登录" className="min-h-0 w-full flex-1 rounded-lg border" referrerPolicy="origin" /></DialogContent></Dialog></>
}
