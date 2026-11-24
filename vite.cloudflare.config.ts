import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: repositoryRoot,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    tailwindcss(),
    {
      name: 'tgbotpress-d1-db-entry',
      enforce: 'pre',
      resolveId(source) {
        if (source === './db.server' || source === '../server/db.server' || source === '../../server/db.server') {
          return fileURLToPath(new URL('./src/server/db.d1.server.ts', import.meta.url))
        }
      },
    },
    cloudflare(),
    tanstackStart(),
    react(),
  ],
})
