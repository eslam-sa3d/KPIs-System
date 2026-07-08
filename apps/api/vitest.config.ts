import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@pulse/contracts': path.resolve(__dirname, '../../packages/contracts/src') },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
