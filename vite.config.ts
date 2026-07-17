import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // The crypto core is pure and I/O-free, so it tests under Node's native
    // WebCrypto — the same primitives the browser exposes as crypto.subtle.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
