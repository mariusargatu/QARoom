import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// React + Vite + Tailwind 4 (CSS-first @theme, no tailwind.config.js). The atomic-design component
// library and the model-based-tested dashboard are built on this (ADR-0005).
//
// The app calls its API SAME-ORIGIN (`/api`, `/ws`) because in the cluster the ingress serves web
// and gateway on one host. On the dev server there is no such host, and the gateway sets no CORS
// headers, so pointing VITE_API_BASE_URL at another origin cannot work either: without the proxy
// below, `pnpm dev` produced an app that could not reach a backend by ANY route — every request
// fell through to Vite's SPA fallback and came back as index.html. The proxy reproduces the
// ingress's same-origin arrangement locally.
// Addressed by IP with an explicit Host header, NOT as http://qaroom.localhost. Browsers and curl
// map *.localhost to 127.0.0.1 themselves (RFC 6761); Node's resolver does not, and hands back
// ENOTFOUND — so a proxy targeting the hostname 502s every request. k3d publishes the Traefik
// loadbalancer on host port 80, and Traefik routes by the Host header, so this reaches the same
// Ingress rule the browser does.
const GATEWAY = process.env.QAROOM_GATEWAY_URL ?? 'http://127.0.0.1:80'
const GATEWAY_HOST = process.env.QAROOM_GATEWAY_HOST ?? 'qaroom.localhost'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: GATEWAY, changeOrigin: false, headers: { Host: GATEWAY_HOST } },
      // `ws: true` upgrades the ticket-authed activity socket (ADR-0013) through the same origin.
      '/ws': { target: GATEWAY, changeOrigin: false, ws: true, headers: { Host: GATEWAY_HOST } },
    },
  },
})
