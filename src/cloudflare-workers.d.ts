declare module 'cloudflare:workers' {
  export const env: { DB: import('./server/database/d1.server').D1Binding }
}
