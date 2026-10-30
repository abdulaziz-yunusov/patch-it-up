import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// base = the GitHub repo name, so the game works on GitHub Pages.
// mkcert = HTTPS with a certificate this PC trusts (no "not secure"
// warning), so the microphone works when friends test from another PC
// or phone (npm run host). Other devices must trust the mkcert root CA.
export default defineConfig({
  base: '/patch-it-up/',
  plugins: [mkcert()],
});
