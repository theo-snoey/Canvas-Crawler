import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'extension/dist',
    rollupOptions: {
      input: {
        // Service worker
        'background/serviceWorker': resolve(__dirname, 'extension/src/background/serviceWorker.ts'),
        
        // Content script
        'content/contentScript': resolve(__dirname, 'extension/src/content/contentScript.ts'),
        
        // Popup
        'popup/popup': resolve(__dirname, 'extension/src/popup/popup.ts'),
        
        // Options
        'options/options': resolve(__dirname, 'extension/src/options/options.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    },
    target: 'es2020',
    minify: false // Keep readable for debugging
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'extension/src')
    }
  },
  
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
  }
});
