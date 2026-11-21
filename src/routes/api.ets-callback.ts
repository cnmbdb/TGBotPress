import { createFileRoute } from '@tanstack/react-router'

// The one-time credential is in the fragment and never reaches the server.
const html = `<!doctype html><meta charset="utf-8"><title>正在完成登录</title><p>正在返回插件平台，请稍候。</p><script>if(window.opener && location.hash.startsWith('#/appstore-expand?')){const fragment=location.hash;history.replaceState(null,'',location.pathname);window.opener.postMessage({type:'TG_ETS_SOCIAL_CALLBACK',fragment},location.origin);window.close()}else{document.querySelector('p').textContent='登录窗口已失效，请返回后台重新登录。'}</script>`
export const Route = createFileRoute('/api/ets-callback')({ server: { handlers: { GET: async () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } }) } } })
