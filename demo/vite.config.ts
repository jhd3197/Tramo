import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // host: true binds to 0.0.0.0 so Vite prints both Local and Network URLs.
    host: true,
    strictPort: true,
  },
});
