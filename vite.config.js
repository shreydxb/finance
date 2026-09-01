import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      treeshake: {
        // Both Vite entries use the public design-system barrel. These modules
        // are pure React presentation modules, so the app may retain only the
        // named primitives it imports instead of the preview's entire graph.
        moduleSideEffects: (id) => !/[\\/]src[\\/]design-system[\\/]/.test(id),
      },
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        designSystem: resolve(import.meta.dirname, 'design-system.html'),
        shellPreview: resolve(import.meta.dirname, 'shell-preview.html'),
        v6OverviewPreview: resolve(import.meta.dirname, 'v6-overview-preview.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.jsx'],
    setupFiles: ['./src/test/setup.js'],
  },
})
