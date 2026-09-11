import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

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
    // Bind every interface, not just loopback, so the app is reachable from
    // other devices on the same network — a phone testing the review screens,
    // a second machine signing in as Leadership. Vite's default is localhost,
    // which silently makes the dev server single-machine.
    host: true,
    /*
     * Vite rejects a Host header it does not recognise — DNS-rebinding
     * protection — which allows raw IPs but answers 403 to the Mac's own
     * Bonjour name. That name is the more useful address of the two: a DHCP
     * lease changes the IP, `<machine>.local` keeps working.
     *
     * Scoped to the `.local` suffix rather than opened with `true`, so this
     * stays a LAN affordance and not an invitation to any Host header.
     */
    allowedHosts: ['.local'],
    proxy: {
      /*
       * SAME-ORIGIN API, DELIBERATELY.
       *
       * The alternative is baking an absolute VITE_API_URL, and that breaks the
       * moment a second device opens the app: `localhost:4001` on a phone is
       * the phone. Hard-coding the LAN IP instead just moves the problem — it
       * changes whenever DHCP reassigns.
       *
       * Proxying `/api` here means the bundle ships a RELATIVE base and works
       * from whatever host served it. It is also exactly what nginx does in the
       * container image, so dev and the on-prem deployment resolve the API the
       * same way rather than diverging.
       */
      '/api': {
        target: 'http://127.0.0.1:4001',
        changeOrigin: true,
        // A discovery run executes INSIDE its HTTP request and holds it open
        // for the whole crawl, and three routes stream (SSE). Both default
        // timeouts would cut those; 0 disables them.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1400,
  },
})
