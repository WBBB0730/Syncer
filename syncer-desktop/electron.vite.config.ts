import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@syncer/protocol']
      }
    },
    resolve: {
      alias: {
        '@syncer/protocol': resolve('../packages/syncer-protocol/src/index.ts')
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
