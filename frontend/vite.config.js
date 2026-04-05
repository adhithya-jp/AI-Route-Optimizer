import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Output to frontend/dist — referenced by vercel.json static build
    outDir: 'dist',
  },
  server: {
    // In local dev, forward /api/* to the FastAPI backend running on port 8000
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Strip the /api prefix before forwarding to the backend
        // because the local api.py routes are /reset, /find-path, etc.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
