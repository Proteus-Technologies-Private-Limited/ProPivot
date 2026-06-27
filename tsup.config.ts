import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Library entries: ESM + CJS + d.ts
    entry: {
      index: 'src/index.ts',
      react: 'src/wrappers/react.tsx',
      vue: 'src/wrappers/vue.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['react', 'vue'],
    // Copy the base stylesheet into dist as propivot.css
    onSuccess: 'node -e "require(\'fs\').copyFileSync(\'src/grid/propivot.css\',\'dist/propivot.css\')"',
  },
  {
    // Browser global build: defines window.ProPivot when loaded via <script>.
    // tsup appends ".global.js" for the iife format, so the entry key is "propivot"
    // -> dist/propivot.global.js
    entry: { propivot: 'src/global.ts' },
    format: ['iife'],
    dts: false,
    sourcemap: true,
    minify: true,
    platform: 'browser',
  },
  {
    // Web Worker bundle -> dist/propivot.worker.js (ESM module worker).
    entry: { 'propivot.worker': 'src/worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    minify: true,
    platform: 'browser',
  },
]);
