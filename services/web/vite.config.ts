import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// React + Vite + Tailwind 4 (CSS-first @theme, no tailwind.config.js). The atomic-design
// library and the model-based-tested dashboard are built on this (ADR-0005).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
})
