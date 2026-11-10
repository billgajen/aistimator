import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // T-150: tests render components (react-dom/server) with the automatic JSX runtime, as Next does
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@estimator/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
})
