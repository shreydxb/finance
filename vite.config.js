import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        designSystem: resolve(import.meta.dirname, 'design-system.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.jsx'],
    setupFiles: ['./src/test/setup.js'],
  },
})
