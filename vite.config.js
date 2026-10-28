import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background.js'),
        content: resolve(import.meta.dirname, 'src/content.js'),
        manager: resolve(import.meta.dirname, 'src/svg-core/manager.js'),
        styles: resolve(import.meta.dirname, 'src/styles.css'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    outDir: 'dist',
  },
  publicDir: 'public',
});
