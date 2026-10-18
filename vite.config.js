import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// base = the GitHub repo name, so the game works on GitHub Pages.
// basicSsl = HTTPS on the local network, so the microphone works
// when friends test from another PC or phone (npm run host).
export default defineConfig({
  base: '/patch-it-up/',
  plugins: [basicSsl()],
});
