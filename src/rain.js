// Rain around the ship while it flies: thin streaks falling past the bow
// window and the portholes. Drops only ever fall outside the hull's
// footprint, so it never rains indoors. Turned off in the settings, or
// at the dock, the whole thing is hidden and costs nothing.

import * as THREE from 'three';
import { SHIP } from './world.js';

const DROPS = 900;
const AREA = { x: 42, z: 30, top: 18, bottom: -14 }; // half-widths in x and z
const HULL = { x: SHIP.length / 2 + 0.8, z: SHIP.width / 2 + 0.8 }; // plus a margin for the rocking
const FALL = 22; // metres per second
const STREAK = 0.9; // metres long
const WIND = 3; // sideways drift, metres per second

export function createRain(ship) {
  const positions = new Float32Array(DROPS * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: '#9fb0e0', transparent: true, opacity: 0.45, depthWrite: false })
  );
  lines.frustumCulled = false; // the drops move every frame; the box never matches
  lines.raycast = () => {}; // look-rays for stations skip 900 streaks of rain
  lines.visible = false;
  ship.add(lines); // ship space, so the hull footprint stays where the hull is

  const drops = Array.from({ length: DROPS }, () => place({}, true));

  // A new drop somewhere around the ship but never above it.
  function place(drop, anywhere) {
    do {
      drop.x = (Math.random() * 2 - 1) * AREA.x;
      drop.z = (Math.random() * 2 - 1) * AREA.z;
    } while (Math.abs(drop.x) < HULL.x && Math.abs(drop.z) < HULL.z);
    drop.y = anywhere ? AREA.bottom + Math.random() * (AREA.top - AREA.bottom) : AREA.top;
    return drop;
  }

  return {
    update(dt, on) {
      lines.visible = on;
      if (!on) return;
      drops.forEach((drop, i) => {
        drop.y -= FALL * dt;
        drop.x += WIND * dt;
        if (drop.y < AREA.bottom || drop.x > AREA.x) place(drop, false);
        // Wind can push a drop over the deck: start it again elsewhere.
        if (Math.abs(drop.x) < HULL.x && Math.abs(drop.z) < HULL.z) place(drop, false);
        const k = i * 6;
        positions[k] = drop.x;
        positions[k + 1] = drop.y;
        positions[k + 2] = drop.z;
        positions[k + 3] = drop.x - (WIND / FALL) * STREAK;
        positions[k + 4] = drop.y + STREAK;
        positions[k + 5] = drop.z;
      });
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
