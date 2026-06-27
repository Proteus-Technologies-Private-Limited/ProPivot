import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The ProPivot library is shipped as a pre-built bundle inside ./vendor/propivot
// and wired up as a local `file:` dependency (see package.json). Excluding it from
// Vite's dependency pre-bundling keeps its internal chunk imports intact.
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@proteus/propivot'],
  },
});
