import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@pulse/contracts': path.resolve(__dirname, '../../packages/contracts/src') },
  },
  test: {
    include: ['test/**/*.integration.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
