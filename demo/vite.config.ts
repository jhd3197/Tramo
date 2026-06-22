import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (p: string) => path.resolve(__dirname, '../packages', p);

// Alias every workspace import to the package's TS source so Vite reads
// and HMRs the .tsx files directly. Without these, the demo loads the
// compiled `dist/*.js` produced by each package's `tsc --watch` — and if
// those watch processes aren't running, source edits silently never reach
// the browser. (That's the failure mode you'll see if `npm run demo` is
// running but `npm run dev` at the workspace root isn't.) Order matters:
// more-specific patterns must come before the catch-all `^tramo$`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // host: true binds to 0.0.0.0 so Vite prints both Local and Network URLs.
    host: true,
    strictPort: true,
  },
  resolve: {
    alias: [
      { find: 'tramo/styles.css', replacement: pkg('tramo-editor/src/react/styles/tramo.scss') },
      { find: /^tramo\/integrations\/(.*)$/, replacement: pkg('integrations/$1/src/index.ts') },
      { find: /^tramo\/(react|agent|spec|runtime)$/, replacement: pkg('tramo/src/$1.ts') },
      { find: /^tramo$/, replacement: pkg('tramo/src/index.ts') },
      { find: /^@tramo\/editor\/react$/, replacement: pkg('tramo-editor/src/react/index.ts') },
      { find: /^@tramo\/editor\/agent$/, replacement: pkg('tramo-editor/src/agent/index.ts') },
      { find: /^@tramo\/(gmail|github|telegram|discord|notion|openai|anthropic|linear|airtable|stripe)$/, replacement: pkg('integrations/$1/src/index.ts') },
      { find: /^@tramo\/spec$/, replacement: pkg('spec/src/index.ts') },
      { find: /^@tramo\/runtime$/, replacement: pkg('runtime/src/index.ts') },
    ],
  },
});
