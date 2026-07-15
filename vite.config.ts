import { defineConfig, loadEnv, Plugin } from 'vite'
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
export default defineConfig(({ mode }) => {
  // Picks up .env.local, where scripts/dev.sh writes the backend's
  // ephemeral port (falls back to :3002 for non-coordinated runs).
  const env = loadEnv(mode, process.cwd())
  const backendTarget = `http://localhost:${env.VITE_BACKEND_PORT || '3002'}`

  return {
    plugins: [blockRawD2Plugin(), react()],
    server: {
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '^/manual/.*\\.svg$': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
