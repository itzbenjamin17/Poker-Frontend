import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production security headers live in security-headers.conf, which nginx includes.
// `vite preview` serves them unchanged, so a local preview runs under the production policy.
function readSecurityHeaders(): Record<string, string> {
  const conf = readFileSync(fileURLToPath(new URL('./security-headers.conf', import.meta.url)), 'utf8')
  return Object.fromEntries(
    [...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)].map(([, name, value]) => [name, value]),
  )
}

const securityHeaders = readSecurityHeaders()

// The dev server relaxes only what Vite's tooling needs: React Refresh injects an inline
// preamble, the Vite client writes HTML for its error overlay, and VITE_WS_URL may point
// straight at the local backend.
const devSecurityHeaders = {
  ...securityHeaders,
  'Content-Security-Policy': securityHeaders['Content-Security-Policy']
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", "connect-src 'self' http://localhost:8080 ws://localhost:8080 wss://localhost:8080")
    .replace(/;\s*require-trusted-types-for 'script'/, ''),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
      react(),
      tailwindcss()
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/motion')) return 'motion';
          if (id.includes('node_modules/@stomp/stompjs')) return 'stomp';
        }
      }
    }
  },
  server: {
    allowedHosts: [
      '.ngrok-free.dev'
    ],
    headers: devSecurityHeaders,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'http://localhost:8080', ws: true }
    }
  },
  preview: {
    headers: securityHeaders,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['**/e2e/**', '**/scripts/**', '**/node_modules/**', '**/.scratch/**'],
    testTimeout: 20000,
  }
})
