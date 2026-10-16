import { defineConfig } from 'vite';

// Browser build for the text-first UI. The engine itself stays DOM-free and
// fully testable headless (see AGENTS.md).
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
