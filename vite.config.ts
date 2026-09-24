import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'

/**
 * The API port, read from the same place the API reads it.
 *
 * `server/.env` is the single home for PORT; this used to hardcode 4001 beside
 * it, which is two homes for one number. Falls back to the same 4001 default
 * `server/src/config.ts` uses, so an absent .env still resolves identically.
 */
function apiPort(): number {
  const fromEnv = process.env.PORT?.trim()
  if (fromEnv && Number.isFinite(Number.parseInt(fromEnv, 10))) {
    return Number.parseInt(fromEnv, 10)
  }

  for (const name of ['.env', 'secrets.env']) {
    const path = fileURLToPath(new URL(`./server/${name}`, import.meta.url))
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*PORT\s*=\s*(\d+)/.exec(line)
      if (match?.[1]) return Number.parseInt(match[1], 10)
    }
  }
  return 4001
}

const API_PORT = apiPort()

/**
 * Extra hostnames the dev server will answer to, from `ALLOWED_HOSTS`.
 *
 * Comma-separated. A leading dot matches a whole domain, exactly as Vite's own
 * entries do. `ALLOWED_HOSTS=*` disables the host check entirely — deliberately
 * spelled out rather than the default, because it turns off DNS-rebinding
 * protection.
 */
const EXTRA_ALLOWED_HOSTS: string[] = (process.env.ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0)

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
     * protection — which allows raw IPs but answers 403 to a name.
     *
     * `['.local']` covered the Bonjour name and nothing else, so a visitor on
     * Windows typing `http://Mac-mini-2:5173` — the bare DHCP hostname, which is
     * what Windows and most routers resolve — got a 403 that the browser
     * presents as the site being broken. `.lan` and `.home` are what consumer
     * routers commonly append, and the bare name is read from the machine itself
     * rather than written down, so renaming the Mac cannot silently break this.
     *
     * Still a list rather than `true`: this is a LAN affordance, not an
     * invitation to any Host header a rebinding attack cares to send.
     */
    allowedHosts: EXTRA_ALLOWED_HOSTS.includes('*') ? true : [
      '.local',
      '.lan',
      '.home',
      '.internal',
      /*
       * Cloudflare quick tunnels. `deploy/cloudflare/tunnel.sh` publishes the dev
       * server at a generated `*.trycloudflare.com` name, and Vite answers 403 to
       * any Host it does not recognise — which presented as the whole platform
       * being broken over the tunnel rather than as a host check.
       *
       * Still a suffix rather than `true`: this admits Cloudflare's tunnel
       * domain, not any Host header a rebinding attack cares to send.
       */
      '.trycloudflare.com',
      // Cloudflare Pages' own domain, and Vercel/Netlify previews — the same
      // situation as a quick tunnel: a generated name nobody can write down.
      '.pages.dev',
      '.vercel.app',
      '.netlify.app',
      // The production domain, fronting the AWS instance on :3010.
      'sma.ethara.ai',
      // Anything else the operator is actually deploying behind, from the
      // environment rather than from this file. A named tunnel or a real
      // domain (`socialai.ethara.ai`) is a host Vite has never heard of, and
      // the 403 it returns reads as the whole platform being broken. One
      // comma-separated variable admits it without editing code or opening the
      // server to every Host header a rebinding attack cares to send:
      //   ALLOWED_HOSTS=socialai.ethara.ai,.internal.example
      ...EXTRA_ALLOWED_HOSTS,
      // Both cases: the suffix rules above are matched case-insensitively but an
      // exact host is not, and DNS is case-insensitive — so a browser sending
      // `mac-mini-2` for a machine named `Mac-mini-2` was answered with a 403.
      hostname().replace(/\.local$/i, ''),
      hostname().replace(/\.local$/i, '').toLowerCase(),
    ],
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
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        // A discovery run executes INSIDE its HTTP request and holds it open
        // for the whole crawl, and three routes stream (SSE). Both default
        // timeouts would cut those; 0 disables them.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  /*
   * PREVIEW — what a REMOTE client should be served.
   *
   * The dev server hands out hundreds of individual ES modules and needs an HMR
   * websocket. That is right on localhost and wrong through a tunnel: a remote
   * browser pays a round trip per module and the HMR socket frequently cannot
   * connect, so the app loads slowly or not at all. `vite preview` serves the
   * built bundle — a handful of files, no websocket — which is what makes the
   * deployed URL usable from another machine.
   *
   * `preview` needs its own proxy and host allowlist: it does NOT inherit
   * `server.*`, which is easy to miss and presents as the API 404ing in
   * production while working in dev.
   */
  preview: {
    port: 4173,
    strictPort: false,
    host: true,
    // The production domain is served from HERE: nginx fronts `vite preview` on
    // :3010 (deploy/aws/). Without it every request answered 403.
    allowedHosts: ['.local', '.lan', '.home', '.internal', '.trycloudflare.com', 'sma.ethara.ai', ...EXTRA_ALLOWED_HOSTS],
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
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
