import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { alias: { '@': '/src' } },
  base: '/',
  build: {
    outDir: '../dist/web',                         // 【key】放 backend 的 dist/web/，方便 fly.io serving/*
    emptyOutDir: true, manifest: false,
    rollupOptions: {
      input: { index: '/src/index.ts' },
      output: { 
        entryFileNames: '[name].js', 
        assetFileNames: ({ name }) => name?.endsWith('.svg') ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]'
      }
    }
  },
  server: { 
    port: 5173,
    proxy: {
      '/api/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, '')
      }
    }
  }
})