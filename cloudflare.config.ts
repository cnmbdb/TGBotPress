import { bindings, defineConfig } from 'cf/config'

const localD1Id = '00000000-0000-4000-8000-000000000001'

export default defineConfig(({ mode }) => {
  const databaseId = mode === 'cloudflare-local' ? localD1Id : process.env.TGBOTPRESS_D1_ID
  return {
    worker: {
      name: 'tgbotpress',
      compatibilityDate: '2026-11-22',
      compatibilityFlags: ['nodejs_compat'],
      entrypoint: '@tanstack/react-start/server-entry',
      env: {
        DB: bindings.d1({ name: 'tgbotpress', ...(databaseId ? { id: databaseId } : {}) }),
      },
    },
  }
})
