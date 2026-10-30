// The cabin from outside: a planked boat-shaped belly under the floor with
// a raked prow below the pilot's window, rub rails along the waterline and
// the roof edge, each room's colour in a band down both sides (so from the
// dock you can tell which room is where), brass portholes that match the
// helm's own, and a brass frame round the bow window.
//
// Scenery only: no colliders, and mesh() lets look-rays through, so
// nothing here changes what can be walked into or used. Every piece stays
// outside the walls: the prow is lower than the window (bottom 1.1 m), so
// the pilot's view is untouched.

import * as THREE from 'three';
import { GANGPLANK, ROOMS, ROOM_HALF, SHIP } from './world.js';
import { mesh, paint } from './harbour.js';

const HALF_L = SHIP.length / 2;
const OUT = SHIP.width / 2 + SHIP.thickness / 2; // the walls' outer face, 3.1
const PROW = HALF_L + 2.6; // the tip of the prow
const STERN = -HALF_L - 0.6; // the stern overhang
const KEEL = -1.4; // the deepest point of the belly
const BRASS = '#d9a441';

// The belly's cross-section at x: half-width, deck line and keel.
function section(x) {
  if (x > HALF_L) {
    // the prow: narrowing to a point, the deck line raked up towards it
    const s = Math.min(1, (x - HALF_L) / (PROW - HALF_L));
    return { hw: (OUT + 0.02) * Math.pow(1 - s * s, 0.6), top: s ** 1.5, keel: KEEL + 2.2 * s * s };
  }
  if (x < -HALF_L) {
    // a short rounded stern
    const s = Math.min(1, (-HALF_L - x) / (-HALF_L - STERN));
    return { hw: (OUT + 0.02) * (1 - 0.18 * s * s), top: 0, keel: KEEL + 0.5 * s * s };
  }
  return { hw: OUT + 0.02, top: 0, keel: KEEL };
}

// Planks running fore and aft: strakes with dark seams, staggered butt
// joints and a row of nail heads, on white so the colour tints it.
function plankTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 4; i++) {
    const y = i * 32;
    g.fillStyle = i % 2 ? 'rgba(255, 255, 255, 1)' : 'rgba(225, 215, 205, 1)';
    g.fillRect(0, y, 256, 32);
    g.fillStyle = 'rgba(60, 30, 10, 0.55)';
    g.fillRect(0, y, 256, 3);
    const joint = (i * 97) % 256;
    g.fillRect(joint, y, 3, 32);
    g.fillStyle = 'rgba(60, 30, 10, 0.4)';
    for (const dx of [8, 24]) {
      g.beginPath();
      g.arc((joint + dx) % 256, y + 16, 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// The belly: sections from stern to prow, each a U from the port deck
// line down round the keel and up to the starboard one.
function belly() {
  const xs = [];
  for (let x = STERN; x < -HALF_L; x += 0.15) xs.push(x);
  for (let x = -HALF_L; x < HALF_L; x += 1) xs.push(x);
  for (let x = HALF_L; x < PROW; x += 0.13) xs.push(x);
  xs.push(PROW);
  const ring = 14; // points round each section
  const pos = [];
  const uv = [];
  const index = [];
  for (const x of xs) {
    const { hw, top, keel } = section(x);
    for (let j = 0; j <= ring; j++) {
      const phi = (j / ring) * Math.PI; // 0 port deck line, PI starboard
      const c = Math.cos(phi);
      pos.push(x, top - (top - keel) * Math.sin(phi), -hw * Math.sign(c) * Math.pow(Math.abs(c), 0.55));
      uv.push(x / 4, (j / ring) * 2.5);
    }
  }
  const row = ring + 1;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * row + j;
      const b = a + row;
      index.push(a, b, a + 1, b, b + 1, a + 1); // outward, checked at the keel
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// The deck on top of the prow and the stern overhang, and the stern's
// transom: only outside the walls, so nothing shows through the floor.
function caps() {
  const pos = [];
  const strip = (from, to, step) => {
    for (let x = from; x < to - 1e-6; x += step) {
      const x2 = Math.min(to, x + step);
      const a = section(x);
      const b = section(x2);
      // port then starboard edge at each end, wound to face up
      pos.push(x, a.top, -a.hw, x, a.top, a.hw, x2, b.top, -b.hw);
      pos.push(x2, b.top, -b.hw, x, a.top, a.hw, x2, b.top, b.hw);
    }
  };
  strip(HALF_L + SHIP.thickness / 2, PROW, 0.13);
  strip(STERN, -HALF_L - SHIP.thickness / 2, 0.15);
  // the transom: a fan across the stern's last section, facing aft
  const end = section(STERN);
  const ring = 14;
  let prev = null;
  for (let j = 0; j <= ring; j++) {
    const phi = (j / ring) * Math.PI;
    const c = Math.cos(phi);
    const p = [STERN, end.top - (end.top - end.keel) * Math.sin(phi), -end.hw * Math.sign(c) * Math.pow(Math.abs(c), 0.55)];
    if (prev) pos.push(STERN, end.top, 0, ...prev, ...p);
    prev = p;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function porthole() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.36, 0.07, 10, 28), paint(BRASS, { rough: 0.3 })));
  g.add(mesh(new THREE.CircleGeometry(0.31, 28), paint('#ffd98a', { emissive: '#ffc561', glow: 0.9, rough: 0.2 }), 0, 0, 0, { shadow: false }));
  return g;
}

export function buildHull(world) {
  const root = new THREE.Group();
  root.name = 'hullOutside';

  const planks = new THREE.MeshStandardMaterial({ color: '#8a5232', map: plankTexture(), roughness: 0.8 });
  root.add(mesh(belly(), planks));
  root.add(mesh(caps(), paint('#a87447', { rough: 0.8 })));

  // rub rails: one at the deck line, one along the roof edge. The deck-line
  // one stops either side of the cargo door, so the gangplank's threshold
  // stays clear.
  const rail = paint('#4a2c18', { rough: 0.6 });
  const door = GANGPLANK.halfWidth + 0.05;
  const run = HALF_L + 0.1 - door;
  for (const side of [-1, 1]) {
    if (side < 0) {
      for (const end of [-1, 1]) root.add(mesh(new THREE.BoxGeometry(run, 0.2, 0.12), rail, end * (door + run / 2), 0.02, side * (OUT + 0.06)));
    } else {
      root.add(mesh(new THREE.BoxGeometry(SHIP.length + 0.2, 0.2, 0.12), rail, 0, 0.02, side * (OUT + 0.06)));
    }
    root.add(mesh(new THREE.BoxGeometry(SHIP.length + 0.2, 0.16, 0.1), rail, 0, SHIP.wallHeight + 0.12, side * (OUT + 0.05)));
  }
  // the prow's own rail, following its raked deck line out to the tip
  const prowRail = paint(BRASS, { rough: 0.35 });
  for (const side of [-1, 1]) {
    let prev = null;
    for (let x = HALF_L; x <= PROW + 1e-6; x += 0.26) {
      const s = section(Math.min(x, PROW - 0.01));
      const p = new THREE.Vector3(x, s.top + 0.05, side * (s.hw + 0.03));
      if (prev) {
        const piece = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), prowRail);
        piece.position.copy(prev).add(p).multiplyScalar(0.5);
        piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize());
        piece.scale.y = p.distanceTo(prev) + 0.02;
        root.add(piece);
      }
      prev = p;
    }
  }

  // each room's colour down both sides, the same material as the stripe
  // inside, so the colour-blind palettes repaint it too
  for (const room of ROOMS) {
    const accent = world.roomMaterials?.[room.id]?.accent ?? paint(room.color);
    for (const side of [-1, 1]) {
      root.add(mesh(new THREE.BoxGeometry(2 * ROOM_HALF - 0.4, 0.3, 0.04), accent, room.x, 2.62, side * (OUT + 0.02)));
    }
  }

  // portholes outside the helm's three (cabin.js): port 12.6 and 9.2,
  // starboard 12.9, all at 1.75 m
  for (const [side, x] of [[-1, 12.6], [-1, 9.2], [1, 12.9]]) {
    const p = porthole();
    p.position.set(x, 1.75, side * (OUT + 0.02));
    p.rotation.y = side > 0 ? 0 : Math.PI;
    root.add(p);
  }

  // a brass frame round the bow window (3 m wide, 1.1 to 2.4 m up)
  const frame = paint(BRASS, { rough: 0.35 });
  const fx = HALF_L + SHIP.thickness / 2 + 0.04;
  root.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 3.24), frame, fx, 1.04, 0));
  root.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 3.24), frame, fx, 2.46, 0));
  for (const side of [-1, 1]) root.add(mesh(new THREE.BoxGeometry(0.08, 1.54, 0.12), frame, fx, 1.75, side * 1.56));

  world.ship.add(root);
  return root;
}
