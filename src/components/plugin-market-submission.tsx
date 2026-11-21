import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function PluginMarketSubmission({etsAccessToken}:{etsAccessToken:string|null}) {
 const client = useQueryClient()
 const [name,setName]=useState(''), [description,setDescription]=useState(''), [command,setCommand]=useState(''), [image,setImage]=useState<string|null>(null), [error,setError]=useState('')
 const mutation=useMutation({mutationFn:()=>api('/api/plugin-market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,command,image,etsAccessToken})}),onSuccess:()=>{setName('');setDescription('');setCommand('');setImage(null);setError('');void client.invalidateQueries({queryKey:['plugin-market']})}})
 function submit(e:FormEvent){e.preventDefault();setError('');mutation.mutate()}
 return <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-4"><div><h2 className="text-base font-semibold">公开上架模块插件</h2><p className="mt-2 text-sm text-muted-foreground">提交后公开展示在 ETS 的 TGBotPress 分类。上架需要有效的 ETS 登录。</p></div><label className="block text-sm">插件名称<Input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label><label className="block text-sm">插件详情介绍<Textarea required maxLength={5000} value={description} onChange={e=>setDescription(e.target.value)} /></label><label className="block text-sm">插件 npm 安装命令<Input required maxLength={240} placeholder="npm install @scope/package" value={command} onChange={e=>setCommand(e.target.value)} /></label><label className="block text-sm">插件图片（可选，PNG/JPEG/WebP，最大 200 KB）<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];setImage(null);if(!f)return;if(f.size>200000){setError('图片不能超过 200 KB');return}setError('');const reader=new FileReader();reader.onload=()=>setImage(String(reader.result));reader.readAsDataURL(f)}} /></label>{image && <img src={image} alt="插件图片预览" className="size-16 rounded-lg object-cover" />}{(error||mutation.isError) && <p role="alert" className="text-sm text-destructive">{error || (mutation.error instanceof Error ? mutation.error.message : '提交失败')}</p>}{mutation.isSuccess && <p role="status" className="text-sm">插件已公开上架到 ETS TGBotPress 分类。</p>}{!etsAccessToken&&<p className="text-xs text-amber-700">请先通过右上角登录 ETS 账号后再提交。</p>}<Button type="submit" disabled={mutation.isPending || !!error || !etsAccessToken}>{mutation.isPending?'提交中…':'公开上架'}</Button></form>
}
