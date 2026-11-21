import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import tailwindcss from '@tailwindcss/vite'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true })
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '0.0.0.0', port: 8083, strictPort: true,
    allowedHosts: process.env.PLATFORM_ORIGIN ? [new URL(process.env.PLATFORM_ORIGIN).hostname] : ['localhost'],
  },
  plugins: [tailwindcss(), tanstackStart(), nitro(), react()],
})
