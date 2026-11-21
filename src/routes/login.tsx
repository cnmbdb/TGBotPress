import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { LanguageSwitcher } from '@/components/locale-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
   const developmentLogin = true
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitDevelopmentLogin = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/native-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', name, password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || '登录失败')
      window.location.assign(result.destination || '/console/home')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败') }
    finally { setBusy(false) }
  }
  return <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
    <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
    <img src="/dmjduckx2.gif" alt="" aria-hidden="true" className="mb-3 h-32 w-32 object-contain sm:h-40 sm:w-40" />
    <section className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      {developmentLogin ? <>
        <form className="space-y-3" onSubmit={submitDevelopmentLogin}>
          <label className="block space-y-1 text-xs font-medium">管理员账号<Input autoComplete="username" value={name} onChange={event => setName(event.target.value)} required maxLength={100} /></label>
          <label className="block space-y-1 text-xs font-medium">密码<Input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={255} /></label>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy}><KeyRound className="size-4" />{busy ? '登录中…' : '登录'}</Button>
        </form>
      </> : <>
      </>}
    </section>
    <a
      href="https://hfz.pw/tgpress"
      target="_blank"
      rel="noreferrer"
      aria-label="TGBotPress基座"
      className="mt-3 inline-flex items-center gap-1.5 text-xs text-foreground/70 transition-colors hover:text-foreground"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-current">
        <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.48 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.28-1.23 3.28-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" />
      </svg>
      <span>TGBotPress基座</span>
    </a>
  </main>
}
