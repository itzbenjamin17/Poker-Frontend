import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig({
  define: {
    global: 'globalThis'
  },
  plugins: [
      react(),
      tailwindcss()
  ],
  server: {
    allowedHosts: [
      '.ngrok-free.app'
    ],
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'http://localhost:8080', ws: true }
    }
  }
})
