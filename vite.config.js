import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        },
        // The source wins. `npm run typecheck` (tsc with emit on) writes a `.js`
        // beside every `.tsx`, and Vite's default order would bundle that stale
        // emit instead of the file being edited. Sources here are TypeScript;
        // nothing legitimate lives in a `.js` that shadows a `.ts`.
        extensions: ['.tsx', '.ts', '.mts', '.mjs', '.js', '.jsx', '.json'],
    },
    server: {
        port: 5173,
        strictPort: false,
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        chunkSizeWarningLimit: 1400,
    },
});
