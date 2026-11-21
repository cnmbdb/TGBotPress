import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Fingerprint, KeyRound, RefreshCw } from 'lucide-react'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { dashboardReference } from '@/config/dashboard-reference'

export const Route = createFileRoute('/console/home')({ component: Dashboard })
function Dashboard() {
  const client = useQueryClient()
  const [passkeyBusy,setPasskeyBusy]=useState(false)
  const [passkeyError,setPasskeyError]=useState('')
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<AdminUser>('/api/me/?scope=dashboard'), retry: false, staleTime: 60_000 })
  const passkeyAvailable = useQuery({ queryKey: ['passkey-login-enabled'], queryFn: () => api<{enabled:boolean}>('/api/passkey-auth'), enabled: !me.isPending && !me.data, retry: false, staleTime: 60_000 })
  const passkeyOptions = useQuery({ queryKey: ['passkey-login-options'], queryFn: () => api<{options:PublicKeyCredentialRequestOptionsJSON;flow_token:string}>('/api/passkey-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'options'})}), enabled: !me.isPending && !me.data && passkeyAvailable.data?.enabled===true, retry: false, staleTime: 120_000, gcTime: 120_000 })
  const signInWithPasskey = async () => {
    setPasskeyBusy(true);setPasskeyError('')
    try {
      const flow=passkeyOptions.data || (await passkeyOptions.refetch()).data
      if(!flow) throw new Error('无法获取通行密钥验证请求')
      const credential=await startAuthentication({optionsJSON:flow.options})
      await api('/api/passkey-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finish',flow_token:flow.flow_token,credential})})
      client.clear();window.location.assign('/console/home')
    } catch(error) { setPasskeyError(error instanceof ApiError?error.message:error instanceof Error?error.message:'通行密钥登录失败') }
    finally { setPasskeyBusy(false) }
  }
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), onSuccess: () => { client.clear(); window.location.assign('/console/home') } })
  if (me.isPending) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="正在加载" /></div>
  if (!me.data) { window.location.replace("/login?destination=home"); return null }
  return <AdminShell user={me.data} title="仪表盘" activeRoute="admin.home" onRefresh={() => me.refetch()} onLogout={() => logout.mutate()}>
    <main className="min-w-0 space-y-3 p-4"><Tabs defaultValue="commands" className="gap-3"><TabsList className="max-w-full justify-start overflow-x-auto sm:w-auto">{dashboardReference.map(section => <TabsTrigger key={section.id} value={section.id} className="shrink-0 px-4">{section.title}</TabsTrigger>)}</TabsList>
      {dashboardReference.map(section => <TabsContent key={section.id} value={section.id}><section className="overflow-hidden rounded-xl bg-card"><div className="hidden md:block"><Table><TableHeader><TableRow><TableHead className="h-10 w-60 px-4">{section.label}</TableHead><TableHead className="h-10 px-4">{section.valueLabel}</TableHead></TableRow></TableHeader><TableBody>{section.rows.map(([label, value]) => <TableRow key={label}><TableCell className="px-4 py-3 align-top font-mono text-xs whitespace-normal break-all">{label}</TableCell><TableCell className="px-4 py-3 text-xs whitespace-normal text-muted-foreground">{value}</TableCell></TableRow>)}</TableBody></Table></div><div className="divide-y md:hidden">{section.rows.map(([label, value]) => <article key={label} className="grid gap-1.5 px-3 py-2.5"><h2 className="break-all font-mono text-[11px] font-medium">{label}</h2><p className="whitespace-pre-line break-words text-xs text-muted-foreground">{value}</p></article>)}</div></section>{section.note && <p className="mt-2 px-1 text-xs text-muted-foreground">{section.note}</p>}</TabsContent>)}
    </Tabs></main>
  </AdminShell>
}
