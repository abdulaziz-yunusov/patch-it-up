# Patch It Up!

Online co-op browser game for up to 3 players: keep a leaky airship flying
as the mechanic, engineer and pilot.

## Run
npm run dev        # local dev server
npm run host       # test on other devices on your Wi-Fi (HTTPS, mic works)
npm run deploy     # build and publish to GitHub Pages

## Your own signalling server
Players find each other through the free public PeerJS server, which is
sometimes slow or down. To use your own (for example `npx peerjs --port 9000`),
put these in a `.env` file before `npm run dev` or `npm run build`:

    VITE_PEER_HOST=your.server.example
    VITE_PEER_PORT=443
    VITE_PEER_PATH=/
    VITE_PEER_SECURE=true

## Stack
Three.js Â· Rapier physics Â· PeerJS (WebRTC) Â· Vite Â· GitHub Pages
