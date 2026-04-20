import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['antd', '@rc-component/qrcode', 'size-sensor'],
  },
  resolve: {
    alias: [
      {
        find: /^@ant-design\/icons-svg\/es\/asn\/.*$/,
        replacement: fileURLToPath(new URL('./src/shims/icons-svg/FallbackOutlined.js', import.meta.url)),
      },
    ],
  },
  server: {
    proxy: {
      // 本地开发：前端请求 /api → student-emotion-web/backend（默认 5001）
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
})
