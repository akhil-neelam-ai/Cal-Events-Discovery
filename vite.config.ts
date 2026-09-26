import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // An explicit floor instead of esnext. It lowers syntax that Safari 15
    // cannot parse, and it keeps the -webkit- prefixes that Safari 17 and
    // earlier need for backdrop blur.
    target: 'safari15'
  }
});
