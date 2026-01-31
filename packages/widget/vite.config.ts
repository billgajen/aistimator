import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/loader.tsx'),
      name: 'EstimatorWidget',
      fileName: 'widget',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Ensure styles are inlined
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
})
