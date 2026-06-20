import { defineConfig } from 'vitest/config'
import path from 'path'
import { config as loadEnv } from 'dotenv'

// Carrega .env.local para que SUPABASE_URL, SERVICE_KEY etc. estejam disponíveis nos testes
loadEnv({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
