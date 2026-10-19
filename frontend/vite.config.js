import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Tách thư viện lớn ra chunk riêng: bundle chính nhỏ hơn, trình duyệt cache thư viện giữa các lần build
        codeSplitting: {
          groups: [
            { name: 'ethers', test: /node_modules[\\/](ethers|@noble|@adraffy)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
