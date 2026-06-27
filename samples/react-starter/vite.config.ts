import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The ProPivot library is shipped as a pre-built bundle inside ./vendor/propivot
// and wired up as a local `file:` dependency (see package.json). Excluding it from
// Vite's dependency pre-bundling keeps its internal chunk imports intact.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@proteus/propivot'],
  },
});
