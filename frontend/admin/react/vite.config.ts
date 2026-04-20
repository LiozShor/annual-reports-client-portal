import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/islands/client-detail.tsx'),
      name: 'AnnualReportsClientDetail',
      formats: ['iife'],
      fileName: () => 'client-detail.js',
    },
    outDir: '../react-dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: 'client-detail.[ext]',
      },
    },
    manifest: true,
    copyPublicDir: false,
  },
})
