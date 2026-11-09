import { defineConfig } from 'vitest/config'

// Unit tests cover the pure modules in src/lib (no React Native runtime)
export default defineConfig({
  test: { include: ['src/__tests__/**/*.test.ts'], environment: 'node' },
})
