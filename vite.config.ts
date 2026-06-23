import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Plugin to block serving .d2 files and let React Router handle them
const blockRawD2Plugin = (): Plugin => ({
  name: 'block-d2-files',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api')) {
        return next()
      }
      if (req.url?.match(/\/manual\/.*\.d2(\?|$)/)) {
        req.url = '/index.html'
      }
      next()
    })
  }
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [blockRawD2Plugin(), react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '^/manual/.*\\.svg$': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})
