import { createServer, request as httpRequest } from 'node:http'

const listenPort = Number(process.env.WEBHOOK_PROXY_PORT || 8084)
const upstreamPort = Number(process.env.UPSTREAM_PORT || process.env.PORT || 8083)

const server = createServer((incoming, outgoing) => {
  const rawPath = (incoming.url || '/').split('?', 1)[0]
  const isWebhook = incoming.method === 'POST' && (rawPath === '/api/telegram/getdata' || rawPath === '/api/telegram/webhook')
  const isHealth = (incoming.method === 'GET' || incoming.method === 'HEAD') && rawPath === '/api/health'
  if (!isWebhook && !isHealth) {
    outgoing.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    outgoing.end('Not Found')
    return
  }
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port: upstreamPort,
    path: incoming.url || '/',
    method: incoming.method,
    headers: { ...incoming.headers, host: `127.0.0.1:${upstreamPort}` },
  }, response => {
    outgoing.writeHead(response.statusCode || 502, response.headers)
    response.pipe(outgoing)
  })
  upstream.on('error', error => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json' })
    outgoing.end(JSON.stringify({ message: 'Webhook upstream unavailable' }))
    console.error('webhook proxy upstream error:', error.message)
  })
  incoming.pipe(upstream)
})

server.listen(listenPort, '0.0.0.0', () => console.log(`Webhook proxy listening on ${listenPort} -> ${upstreamPort}`))
