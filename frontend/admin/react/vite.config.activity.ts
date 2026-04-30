import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// DL-365 Phase 3: second build config for the activity-viewer island.
// Builds into react-dist/activity-viewer.js (IIFE, no emptyOutDir).

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
      entry: resolve(__dirname, 'src/islands/activity-viewer.tsx'),
      name: 'AnnualReportsActivityViewer',
      formats: ['iife'],
      fileName: () => 'activity-viewer.js',
    },
    outDir: '../react-dist',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: 'activity-viewer.[ext]',
      },
    },
    manifest: false,
    copyPublicDir: false,
  },
})
