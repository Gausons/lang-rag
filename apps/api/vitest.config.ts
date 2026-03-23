import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@lang-rag/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts')
    }
  }
});
