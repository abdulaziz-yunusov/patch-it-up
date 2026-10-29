// The harbour around the dock: a floating island under it, trees and
// rocks, a kiosk and bunting, drifting clouds, a sea of cloud below,
// faraway islands with a lighthouse, gulls, and a sunny sky with soft
// shadows. The dock is where every flight starts, so it should look like
// somewhere worth coming back to.
//
// Everything here is scenery: nothing to walk into on the dock (the
// walking area keeps its own colliders), nothing the host has to send.
// It hangs off world.dock, so on takeoff it falls away with the dock and
// is gone in flight, where the storm takes over the sky (updateHarbour).
// Placement is seeded, so every player sees the same harbour.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DOCK } from './world.js';

// --- small helpers -----------------------------------------------------------

export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mats = new Map();
export function paint(color, { rough = 0.85, flat = false, emissive = null, glow = 0, side = THREE.FrontSide, vertex = false } = {}) {
  const key = [color, rough, flat, emissive, glow, side, vertex].join('|');
  if (!mats.has(key)) {
    mats.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: 0,
        flatShading: flat,
        emissive: emissive ?? '#000000',
        emissiveIntensity: glow,
        side,
        vertexColors: vertex,
      })
    );
  }
  return mats.get(key);
}

export function mesh(geometry, material, x = 0, y = 0, z = 0, { shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.userData.shadowSet = true; // decided here, not by main.js's sweep
  m.raycast = () => {}; // scenery: look-rays for stations go straight through
  return m;
}

// A mesh built along y with height 1 (a unit cylinder), laid from one
// point to the other: one geometry serves every rope, whatever its length.
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
export function stretch(m, from, to) {
  _dir.subVectors(to, from);
  const length = _dir.length();
  m.position.copy(from).addScaledVector(_dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, _dir.normalize());
  m.scale.set(1, length, 1);
  return m;
}

// A warm wood grain to multiply over plank colours.
let grain = null;
export function woodGrain() {
  if (grain) return grain;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 512);
  const rand = seeded(11);
  for (let i = 0; i < 46; i++) {
    const x = rand() * 64;
    g.strokeStyle = `rgba(110, 70, 40, ${0.05 + rand() * 0.12})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y / 70 + i) * 2.5, y);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    // a knot or two
    g.fillStyle = 'rgba(100, 60, 30, 0.25)';
    g.beginPath();
    g.ellipse(10 + rand() * 44, rand() * 512, 3 + rand() * 3, 7 + rand() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  grain = new THREE.CanvasTexture(canvas);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 4;
  return grain;
}

// Noise for lumpy rocks and islands: smooth, seeded, cheap.
function lumpy(geometry, amount, seed, { squash = null } = {}) {
  const rand = seeded(seed);
  const waves = Array.from({ length: 5 }, () => ({
    dir: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
    freq: 1.5 + rand() * 3,
    phase: rand() * 6.28,
  }));
  const p = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    let k = 0;
    for (const w of waves) k += Math.sin(n.dot(w.dir) * w.freq + w.phase);
    v.addScaledVector(n, (k / waves.length) * amount);
    if (squash) squash(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Vertex colours from a function of height (y), for gradients on rock.
function shadeByHeight(geometry, pick) {
  const p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    pick(p.getY(i), c, i);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// --- the pieces ------------------------------------------------------------

const PALETTE = {
  plank: ['#d69a5e', '#c98b52', '#dba56b', '#c4844c', '#e0ad75'],
  beam: '#7a4f31',
  grass: '#7cc95a',
  grassDark: '#4f9a43',
  rockTop: '#c98e62',
  rockMid: '#a3685a',
  rockLow: '#6d5b8f',
  pine: ['#2f8a62', '#287a59', '#36996b'],
  leaf: ['#79c94b', '#62b545', '#8fd35a'],
  trunk: '#7a4a2c',
  flags: ['#ff5a5f', '#ffc93c', '#3bb7ff', '#5fd068', '#ff8a3d', '#b77cff'],
  flowers: ['#ff6fa8', '#ffd84d', '#ffffff', '#ff7a45', '#b98cff'],
};

// The dock floor as real planks: staggered joints, slightly different
// shades, a gap between each. The old flat floor and painted lines go.
function buildPlanks(dock, model) {
  for (const name of ['col_dock_floor']) {
    const floor = model?.getObjectByName(name);
    if (floor) floor.visible = false;
  }
  model?.traverse((o) => {
    if (o.isMesh && o.name.startsWith('dock_plank_line')) o.visible = false;
  });
  const rand = seeded(3);
  const width = 0.46;
  const pieces = [];
  for (let x = -6 + width / 2 + 0.01; x < 6; x += width + 0.02) {
    let z = -25;
    let first = true;
    while (z < -5) {
      const len = Math.min(-5 - z, (first ? 1.5 + rand() * 3 : 3 + rand() * 3));
      pieces.push({ x, z: z + len / 2, len, shade: Math.floor(rand() * PALETTE.plank.length), lift: rand() * 0.012 });
      z += len + 0.015;
      first = false;
    }
  }
  const geo = new RoundedBoxGeometry(width, 0.16, 1, 2, 0.025);
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, map: woodGrain() });
  const planks = new THREE.InstancedMesh(geo, material, pieces.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  pieces.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, DOCK.top - 0.08 + p.lift, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, p.len));
    planks.setMatrixAt(i, m);
    planks.setColorAt(i, c.set(PALETTE.plank[p.shade]));
  });
  planks.receiveShadow = true;
  planks.castShadow = true;
  planks.userData.shadowSet = true;
  planks.raycast = () => {};
  dock.add(planks);
  // Dark boards under the gaps, so you see shadow between planks, not sky.
  dock.add(mesh(new THREE.BoxGeometry(12, 0.06, 20), paint('#4a2f1f'), 0, DOCK.top - 0.2, -15, { shadow: false }));
}

// Beams and X-braces between the stilts, so the dock reads as built.
function buildFrame(dock) {
  const wood = paint(PALETTE.beam);
  const beam = (a, b, t = 0.22) => {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const length = from.distanceTo(to);
    const m = mesh(new THREE.BoxGeometry(t, t, length), wood);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to.x + (m.parent ? 0 : 0), to.y, to.z);
    m.lookAt(to);
    dock.add(m);
  };
  const zs = [-24, -18, -12, -6];
  for (const x of [-5, 5]) {
    beam([x, -1.55, -25], [x, -1.55, -5], 0.3);
    for (let i = 0; i < zs.length - 1; i++) {
      beam([x, -1.7, zs[i]], [x, -6.4, zs[i + 1]]);
      beam([x, -6.4, zs[i]], [x, -1.7, zs[i + 1]]);
    }
  }
  for (const z of zs) beam([-5.6, -1.55, z], [5.6, -1.55, z], 0.28);
}

// The floating island under the dock: rock tapering to a point below, a
// grass cap on top, its edge a little ragged.
// How far the island's edge reaches at an angle: a wobbly outline, not a
// circle (the same for rock and grass, so they line up).
function edge(seed) {
  const rand = seeded(seed * 7 + 3);
  const waves = [2, 3, 5, 7].map((k) => ({ k, a: (0.1 + rand() * 0.12) / Math.sqrt(k / 2), p: rand() * 6.28 }));
  return (angle) => 1 + waves.reduce((sum, w) => sum + w.a * Math.sin(angle * w.k + w.p), 0);
}

function island(radiusX, radiusZ, depth, seed, detail = 4) {
  const group = new THREE.Group();
  const reach = edge(seed);
  const rock = lumpy(new THREE.IcosahedronGeometry(1, detail), 0.12, seed, {
    squash: (v) => {
      if (v.y > 0) v.y *= 0.08;
      else v.y *= 1 + (1 - (v.x * v.x + v.z * v.z)) * 0.6;
      const r = reach(Math.atan2(v.z, v.x));
      v.x *= radiusX * r;
      v.z *= radiusZ * r;
      v.y *= v.y < 0 ? depth : 1;
    },
  });
  const top = new THREE.Color(PALETTE.rockTop);
  const mid = new THREE.Color(PALETTE.rockMid);
  const low = new THREE.Color(PALETTE.rockLow);
  shadeByHeight(rock, (y, c) => {
    const t = Math.min(1, Math.max(0, -y / depth));
    if (t < 0.35) c.copy(top).lerp(mid, t / 0.35);
    else c.copy(mid).lerp(low, (t - 0.35) / 0.65);
  });
  group.add(mesh(rock, paint('#ffffff', { flat: true, vertex: true, rough: 0.95 })));
  // grass: a low dome, a shade lighter in the middle
  const grassGeo = lumpy(new THREE.CircleGeometry(1, 48, 0, Math.PI * 2).rotateX(-Math.PI / 2), 0.03, seed + 1, {
    squash: (v) => {
      v.y += 0.06 * (1 - (v.x * v.x + v.z * v.z));
      const r = reach(Math.atan2(v.z, v.x)) * 1.02;
      v.x *= radiusX * r;
      v.z *= radiusZ * r;
    },
  });
  const light = new THREE.Color(PALETTE.grass);
  const dark = new THREE.Color(PALETTE.grassDark);
  const p = grassGeo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i) / radiusX, p.getZ(i) / radiusZ) / reach(Math.atan2(p.getZ(i), p.getX(i)));
    const c = light.clone().lerp(dark, Math.min(1, r * r));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  grassGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  group.add(mesh(grassGeo, paint('#ffffff', { vertex: true, rough: 1 }), 0, 0.12, 0, { shadow: false }));
  return group;
}

function pine(height, rand) {
  const g = new THREE.Group();
  const color = PALETTE.pine[Math.floor(rand() * PALETTE.pine.length)];
  g.add(mesh(new THREE.CylinderGeometry(0.12 * height * 0.1 + 0.08, 0.2 + height * 0.02, height * 0.3, 7), paint(PALETTE.trunk), 0, height * 0.15, 0));
  for (let i = 0; i < 3; i++) {
    const r = height * (0.32 - i * 0.07);
    const h = height * (0.42 - i * 0.06);
    g.add(mesh(new THREE.ConeGeometry(r, h, 8), paint(color, { flat: true }), 0, height * (0.3 + i * 0.2) + h * 0.35, 0));
  }
  return g;
}

function roundTree(height, rand) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.18, height * 0.55, 7), paint(PALETTE.trunk), 0, height * 0.27, 0));
  const color = PALETTE.leaf[Math.floor(rand() * PALETTE.leaf.length)];
  for (let i = 0; i < 3; i++) {
    const r = height * (0.22 + rand() * 0.1);
    const blob = mesh(lumpy(new THREE.IcosahedronGeometry(r, 2), r * 0.08, 50 + i), paint(color, { flat: true }));
    blob.position.set((rand() - 0.5) * height * 0.3, height * (0.62 + rand() * 0.2), (rand() - 0.5) * height * 0.3);
    g.add(blob);
  }
  return g;
}

function rock(size, seed) {
  const geo = lumpy(new THREE.DodecahedronGeometry(size, 1), size * 0.15, seed, { squash: (v) => (v.y *= 0.7) });
  return mesh(geo, paint('#9b8aa8', { flat: true, rough: 0.95 }));
}

function flowerPatch(rand, count, spread) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.07, 0);
  for (let i = 0; i < count; i++) {
    const f = mesh(geo, paint(PALETTE.flowers[Math.floor(rand() * PALETTE.flowers.length)], { flat: true }), (rand() - 0.5) * spread, 0.1, (rand() - 0.5) * spread, { shadow: false });
    g.add(f);
  }
  return g;
}

// Bunting: a sagging rope with triangle flags, one mesh.
function bunting(from, to, sag, rand, lanterns = 0) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const point = (t) => a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => point(i / 11)));
  g.add(mesh(new THREE.TubeGeometry(curve, 40, 0.018, 5), paint('#f3e3c3'), 0, 0, 0, { shadow: false }));
  const count = Math.floor(a.distanceTo(b) / 0.55);
  const positions = [];
  const colors = [];
  const c = new THREE.Color();
  const along = b.clone().sub(a).setY(0).normalize();
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const p = point(t);
    const half = along.clone().multiplyScalar(0.17);
    const v1 = p.clone().sub(half);
    const v2 = p.clone().add(half);
    const v3 = p.clone().add(new THREE.Vector3(0, -0.36, 0));
    positions.push(...v1.toArray(), ...v2.toArray(), ...v3.toArray());
    c.set(PALETTE.flags[i % PALETTE.flags.length]);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const flags = mesh(geo, paint('#ffffff', { vertex: true, side: THREE.DoubleSide, rough: 0.9 }), 0, 0, 0);
  g.add(flags);
  const lamps = [];
  for (let i = 1; i <= lanterns; i++) {
    const p = point(i / (lanterns + 1));
    const color = ['#ff7b54', '#ffd25a', '#ff5f8f'][i % 3];
    const lantern = mesh(new THREE.SphereGeometry(0.2, 14, 10), paint(color, { emissive: color, glow: 0.35, rough: 0.6 }), p.x, p.y - 0.3, p.z, { shadow: false });
    lantern.scale.y = 1.25;
    lantern.material = lantern.material.clone(); // each brightens on its own
    g.add(lantern);
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10), paint('#5b3a22'), p.x, p.y - 0.06, p.z, { shadow: false }));
    lamps.push(lantern);
  }
  return { group: g, lamps, rand };
}

// A row of flowers in a window box, hung on the outside of a rail.
function flowerBox(length, rand) {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(length, 0.22, 0.3, 2, 0.03), paint('#b8643c'), 0, 0, 0));
  g.add(mesh(new THREE.BoxGeometry(length - 0.06, 0.04, 0.24), paint('#5a3b22'), 0, 0.1, 0, { shadow: false }));
  const leaf = new THREE.IcosahedronGeometry(0.09, 0);
  const bloom = new THREE.IcosahedronGeometry(0.075, 1);
  for (let x = -length / 2 + 0.1; x < length / 2 - 0.05; x += 0.13) {
    g.add(mesh(leaf, paint('#4fa84a', { flat: true }), x, 0.17, (rand() - 0.5) * 0.12, { shadow: false }));
    if (rand() < 0.7) {
      const color = PALETTE.flowers[Math.floor(rand() * PALETTE.flowers.length)];
      g.add(mesh(bloom, paint(color, { flat: true }), x + (rand() - 0.5) * 0.06, 0.26 + rand() * 0.08, (rand() - 0.5) * 0.14, { shadow: false }));
    }
  }
  return g;
}

function lifeRing() {
  const g = new THREE.Group();
  const geo = new THREE.TorusGeometry(0.3, 0.085, 10, 24);
  const colors = [];
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const angle = Math.atan2(p.getY(i), p.getX(i));
    c.set(Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 8) % 2 ? '#ffffff' : '#ff4d4d');
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.add(mesh(geo, paint('#ffffff', { vertex: true, rough: 0.6 })));
  return g;
}

export function crate(size, color = '#c8925a') {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(size, size, size, 2, size * 0.06), paint(color), 0, size / 2, 0));
  const band = paint('#8a5a35');
  g.add(mesh(new THREE.BoxGeometry(size * 1.02, size * 0.12, size * 1.02), band, 0, size * 0.2, 0));
  g.add(mesh(new THREE.BoxGeometry(size * 1.02, size * 0.12, size * 1.02), band, 0, size * 0.8, 0));
  return g;
}

export function barrel(height, color = '#b3713f') {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(height * 0.32, height * 0.32, height, 14, 4);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / height;
    const bulge = 1 + 0.12 * Math.cos(y * Math.PI);
    p.setX(i, p.getX(i) * bulge);
    p.setZ(i, p.getZ(i) * bulge);
  }
  body.computeVertexNormals();
  g.add(mesh(body, paint(color), 0, height / 2, 0));
  for (const y of [0.18, 0.82]) g.add(mesh(new THREE.TorusGeometry(height * 0.35, 0.025, 6, 20).rotateX(Math.PI / 2), paint('#5d5a66', { rough: 0.5 }), 0, height * y, 0));
  return g;
}

// A sign with painted letters, both sides.
function sign(text, width, height, { bg = '#2f5d8a', fg = '#fff4dc' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = fg;
  g.lineWidth = 10;
  g.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(canvas.height * 0.5)}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return mesh(new THREE.BoxGeometry(width, height, 0.08), [paint(bg), paint(bg), paint(bg), paint(bg), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }), paint(bg)]);
}

// The harbour master's kiosk, on a little landing past the far rail.
function kiosk() {
  const g = new THREE.Group();
  // the landing it stands on
  g.add(mesh(new RoundedBoxGeometry(12, 0.2, 5, 2, 0.05), paint('#c48a52', { rough: 0.85 }), 0, -0.1, 0));
  for (const x of [-5.4, 5.4]) for (const z of [-2, 2]) g.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.4, 8), paint(PALETTE.beam), x, -3.3, z));
  // the hut
  const hut = new THREE.Group();
  hut.position.set(2.2, 0, -0.4);
  hut.add(mesh(new RoundedBoxGeometry(3.4, 2.5, 2.6, 2, 0.08), paint('#f4ead6'), 0, 1.25, 0));
  hut.add(mesh(new THREE.BoxGeometry(3.5, 0.3, 2.7), paint('#6aa6d9'), 0, 0.15, 0));
  // pitched roof
  const roof = new THREE.CylinderGeometry(1, 1, 3.9, 3, 1);
  roof.rotateZ(Math.PI / 2);
  const roofMesh = mesh(roof, paint('#e05a4f', { flat: true }), 0, 2.85, 0);
  roofMesh.scale.set(1, 0.75, 1.75);
  hut.add(roofMesh);
  // striped awning over the window
  const stripes = [];
  for (let i = 0; i < 8; i++) {
    const s = mesh(new THREE.BoxGeometry(0.36, 0.05, 0.9), paint(i % 2 ? '#ffffff' : '#ff5a5f'), -1.26 + i * 0.36, 1.95, 1.65);
    s.rotation.x = 0.35;
    stripes.push(s);
    hut.add(s);
  }
  hut.add(mesh(new THREE.BoxGeometry(2.2, 0.9, 0.05), paint('#8fd0ff', { rough: 0.2, emissive: '#cfeeff', glow: 0.15 }), 0, 1.35, 1.31, { shadow: false }));
  hut.add(mesh(new THREE.BoxGeometry(2.6, 0.12, 0.4), paint('#8a5a35'), 0, 0.85, 1.45));
  const board = sign('HARBOUR', 2.4, 0.6);
  board.position.set(0, 3.0, 1.75);
  hut.add(board);
  g.add(hut);
  // cargo beside it
  const c1 = crate(0.8);
  c1.position.set(-1.8, 0, 0.6);
  c1.rotation.y = 0.3;
  const c2 = crate(0.6, '#d9a066');
  c2.position.set(-1.7, 0.8, 0.5);
  c2.rotation.y = -0.2;
  const b1 = barrel(1, '#3f8f8a');
  b1.position.set(-3, 0, -0.6);
  const b2 = barrel(0.9);
  b2.position.set(-3.9, 0, 0.3);
  g.add(c1, c2, b1, b2);
  // telescope on a tripod, looking out to sea
  const scope = new THREE.Group();
  scope.position.set(-4.6, 0, -1.6);
  for (let i = 0; i < 3; i++) {
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), paint('#6b4a33'));
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.25, 0.7, Math.sin(a) * 0.25);
    leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
    scope.add(leg);
  }
  const tube = mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.1, 12), paint('#d8b25a', { rough: 0.35 }), 0, 1.5, 0);
  tube.rotation.set(0.2, 0, Math.PI / 2 - 0.25);
  scope.add(tube);
  g.add(scope);
  return g;
}

function lighthouse() {
  const g = new THREE.Group();
  const stripe = (i) => (i % 2 ? '#ffffff' : '#e8463f');
  for (let i = 0; i < 5; i++) {
    const r0 = 1.5 - i * 0.18;
    g.add(mesh(new THREE.CylinderGeometry(r0 - 0.18, r0, 2, 16), paint(stripe(i)), 0, 1 + i * 2, 0));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 16), paint('#3a3a4a'), 0, 10.1, 0));
  const lamp = mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 12), paint('#fff3b0', { emissive: '#ffe680', glow: 1.2 }), 0, 10.75, 0, { shadow: false });
  g.add(lamp);
  g.add(mesh(new THREE.ConeGeometry(0.95, 1, 12), paint('#e8463f'), 0, 11.8, 0));
  return { group: g, lamp };
}

// A gull: two wings that flap.
function gull() {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.12, 8, 6), paint('#ffffff'), 0, 0, 0, { shadow: false });
  body.scale.set(2.2, 0.9, 0.9);
  g.add(body);
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.18, 0, 0.75, -0.22, 0, 0.55], 3));
  wingGeo.computeVertexNormals();
  const material = paint('#f4f4f6', { side: THREE.DoubleSide });
  const left = mesh(wingGeo, material, 0, 0, 0, { shadow: false });
  const right = mesh(wingGeo, material, 0, 0, 0, { shadow: false });
  right.scale.z = -1;
  const tips = mesh(new THREE.BoxGeometry(0.1, 0.01, 0.2), paint('#3a3a46'), 0, 0, 0.7, { shadow: false });
  left.add(tips);
  g.add(left, right);
  g.userData.wings = [left, right];
  return g;
}

// Puffy clouds: one instanced mesh of soft blobs, grouped into clouds that
// drift with the wind and come round again.
function clouds(count, area, rand, { y = [-10, 10], size = [3, 7], flat = 0.6, clear = 0 } = {}) {
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = area.min + rand() * (area.max - area.min);
    const centre = new THREE.Vector3(Math.cos(angle) * dist + area.cx, y[0] + rand() * (y[1] - y[0]), Math.sin(angle) * dist + area.cz);
    const s = size[0] + rand() * (size[1] - size[0]);
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const r = s * (0.45 + rand() * 0.45) * (k === 0 ? 1.2 : 1);
      blobs.push({ cloud: i, offset: new THREE.Vector3((k - n / 2) * s * 0.42 + (rand() - 0.5) * s * 0.3, rand() * s * 0.25, (rand() - 0.5) * s * 0.6), r, centre });
    }
  }
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#e4efff', emissiveIntensity: 0.55 }); // one per cloud layer
  const inst = new THREE.InstancedMesh(geo, material, blobs.length);
  inst.raycast = () => {};
  inst.castShadow = false;
  inst.receiveShadow = false;
  inst.userData.shadowSet = true;
  inst.frustumCulled = false;
  const data = { inst, blobs, flat, area, count, clear };
  placeClouds(data, 0);
  return data;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function placeClouds(data, shift) {
  const span = data.area.wrap;
  data.blobs.forEach((b, i) => {
    let x = b.centre.x + shift;
    if (span) x = ((((x - data.area.cx + span) % (2 * span)) + 2 * span) % (2 * span)) - span + data.area.cx;
    _p.set(x + b.offset.x, b.centre.y + b.offset.y, b.centre.z + b.offset.z);
    // drifting past the ship and the dock, a near cloud thins away to nothing
    const room = data.clear ? Math.min(1, Math.max(0, (Math.hypot(_p.x, (_p.z + 10) * 1.4) - data.clear) / 10)) : 1;
    _s.set(b.r, b.r * data.flat, b.r).multiplyScalar(room);
    data.inst.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  data.inst.instanceMatrix.needsUpdate = true;
}

// A flag that ripples.
function wavingFlag(width, height, color) {
  const geo = new THREE.PlaneGeometry(width, height, 12, 4);
  geo.translate(width / 2, 0, 0);
  const flag = mesh(geo, paint(color, { side: THREE.DoubleSide, rough: 0.9 }), 0, 0, 0);
  flag.userData.rest = Float32Array.from(geo.attributes.position.array);
  return flag;
}

// --- the sky -------------------------------------------------------------------

// A dome that follows the camera: blue above, warm haze at the horizon, a
// glow round the sun, and the cloud sea's white below.
function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3f8fe0') },
      horizon: { value: new THREE.Color('#cfe8fb') },
      bottom: { value: new THREE.Color('#eef5ff') },
      sunColor: { value: new THREE.Color('#fff1c9') },
      sunDir: { value: new THREE.Vector3(-0.5, 0.55, -0.67).normalize() },
      sunAmount: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor;
      uniform vec3 sunDir; uniform float sunAmount;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, 0.15, -h));
        float s = max(dot(d, sunDir), 0.0);
        sky += sunColor * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.35) * sunAmount;
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(390, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.raycast = () => {};
  dome.name = 'skyDome';
  return dome;
}

// --- putting it together -----------------------------------------------------

// Called once the dock model is in: model is the Blender waiting room.
export function buildHarbour(world, scene, model) {
  const dock = world.dock;
  const rand = seeded(2026);
  const harbour = new THREE.Group();
  harbour.name = 'harbour';
  dock.add(harbour);

  buildPlanks(harbour, model);
  buildFrame(harbour);
  restyleModel(model);

  // The island the dock stands on.
  const home = island(13, 16, 13, 7);
  home.position.set(0, -7.6, -18);
  harbour.add(home);
  // Trees and rocks round its edge, clear of the dock.
  const spots = [];
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.45 + rand() * 0.5;
    const x = Math.cos(a) * 13 * r;
    const z = -18 + Math.sin(a) * 16 * r;
    if (Math.abs(x) < 7.6 && z > -28 && z < -3) continue; // under the dock and its landing
    if (z > -6) continue; // beside the ship
    spots.push([x, z]);
  }
  spots.forEach(([x, z], i) => {
    const tall = 3 + rand() * 5;
    const tree = rand() < 0.6 ? pine(tall, rand) : roundTree(tall * 0.8, rand);
    tree.position.set(x, -7.5, z);
    tree.rotation.y = rand() * 6;
    harbour.add(tree);
    if (i % 3 === 0) {
      const r = rock(0.5 + rand() * 0.9, 100 + i);
      r.position.set(x + (rand() - 0.5) * 2, -7.4, z + (rand() - 0.5) * 2);
      harbour.add(r);
    }
    if (i % 2 === 0) {
      const f = flowerPatch(rand, 10, 1.6);
      f.position.set(x + 1, -7.5, z + 1);
      harbour.add(f);
    }
  });

  // The kiosk on its landing past the far rail.
  const k = kiosk();
  k.position.set(0, DOCK.top, -27.7);
  harbour.add(k);

  // Bunting on its own tall poles, just outside the rails: one at each
  // corner and one halfway along each side. Criss-crossing over the dock
  // with lanterns, and along both rails, well above everyone's heads.
  const TIE = 3.6; // where the lines are tied, metres up (the planks are at -1.2)
  const corners = { nw: [-6.2, -25.2], ne: [6.2, -25.2], sw: [-6.2, -4.8], se: [6.2, -4.8], w: [-6.2, -16.5], e: [6.2, -16.5] };
  for (const [x, z] of Object.values(corners)) {
    const height = TIE + 0.3 - DOCK.top;
    harbour.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, height, 8), paint(PALETTE.beam), x, DOCK.top + height / 2, z));
    harbour.add(mesh(new THREE.SphereGeometry(0.14, 10, 8), paint('#ffc93c', { rough: 0.5 }), x, TIE + 0.38, z));
    harbour.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10), paint('#5b3a22'), x, TIE, z));
  }
  const at = (key) => [corners[key][0], TIE, corners[key][1]];
  const lanterns = [];
  for (const [from, to, sag, n] of [
    [at('nw'), at('se'), 0.8, 3],
    [at('ne'), at('sw'), 0.8, 3],
    [at('nw'), at('w'), 0.4, 0],
    [at('w'), at('sw'), 0.4, 0],
    [at('ne'), at('e'), 0.4, 0],
    [at('e'), at('se'), 0.4, 0],
  ]) {
    const b = bunting(from, to, sag, rand, n);
    harbour.add(b.group);
    lanterns.push(...b.lamps);
  }

  // Flower boxes hung outside the rails, life rings on the rails.
  for (const [x, z, len, turn] of [
    [-6.25, -18, 1.6, Math.PI / 2],
    [-6.25, -12.4, 1.6, Math.PI / 2],
    [6.25, -20.2, 1.4, Math.PI / 2],
    [6.25, -10.2, 1.4, Math.PI / 2],
    [-3.6, -4.75, 1.6, 0],
    [3.6, -4.75, 1.6, 0],
  ]) {
    const box = flowerBox(len, rand);
    box.position.set(x, -0.42, z);
    box.rotation.y = turn;
    harbour.add(box);
  }
  for (const [x, z, turn] of [[-6.12, -14.9, Math.PI / 2], [6.12, -23.6, -Math.PI / 2]]) {
    const ring = lifeRing();
    ring.position.set(x, -0.55, z);
    ring.rotation.y = turn;
    harbour.add(ring);
  }

  // Mooring lines from bollards at the dock's edge to cleats on the hull:
  // they go with the dock when she casts off.
  for (const x of [-4.4, 4.4]) {
    harbour.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), paint('#3e4a5c', { rough: 0.5 }), x, DOCK.top + 0.25, -5.35));
    harbour.add(mesh(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), paint('#3e4a5c', { rough: 0.5 }), x, DOCK.top + 0.5, -5.35));
    const a = new THREE.Vector3(x, DOCK.top + 0.42, -5.35);
    const b = new THREE.Vector3(x * 1.25, 0.2, -3.22);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.35, 0));
    const line = new THREE.QuadraticBezierCurve3(a, mid, b);
    harbour.add(mesh(new THREE.TubeGeometry(line, 16, 0.035, 5), paint('#e8d6ae'), 0, 0, 0));
    harbour.add(mesh(new THREE.BoxGeometry(0.4, 0.12, 0.12), paint("#3e4a5c"), x * 1.25, 0.2, -3.18));
  }

  // The yellow flag, waving; the old stiff one goes.
  const oldFlag = model?.getObjectByName('flag_cloth');
  if (oldFlag) oldFlag.visible = false;
  const flag = wavingFlag(1.5, 0.9, '#ffc93c');
  flag.position.set(-5.4, 3.3, -24.4);
  harbour.add(flag);
  const pennant = wavingFlag(1.1, 0.35, '#ff5a5f');
  pennant.position.set(-5.4, 2.6, -24.4);
  harbour.add(pennant);

  // Faraway islands, a lighthouse on the nearest, the cloud sea below.
  const far = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.5;
    const d = 70 + rand() * 90;
    const s = 0.35 + rand() * 0.6;
    const isle = island(15 * s, 13 * s, 16 * s, 20 + i, 3);
    isle.position.set(Math.cos(a) * d, -14 + rand() * 30, -18 + Math.sin(a) * d);
    for (let t = 0; t < 4 + s * 6; t++) {
      const tr = pine((3 + rand() * 4) * (0.6 + s), rand);
      const ta = rand() * 6.28;
      tr.position.set(Math.cos(ta) * 10 * s * rand(), 0.1, Math.sin(ta) * 9 * s * rand());
      isle.add(tr);
    }
    far.add(isle);
  }
  const beaconIsle = island(6, 6, 9, 77);
  beaconIsle.position.set(-38, -6, -48);
  const beacon = lighthouse();
  beaconIsle.add(beacon.group);
  far.add(beaconIsle);
  far.traverse((o) => {
    if (o.isMesh) o.castShadow = false; // too far to throw shadows on the dock
  });
  harbour.add(far);

  const near = clouds(16, { cx: 0, cz: -18, min: 34, max: 70, wrap: 100 }, rand, { y: [-16, 6], size: [3, 7], clear: 26 });
  const sea = clouds(70, { cx: 0, cz: -18, min: 25, max: 230, wrap: 260 }, rand, { y: [-34, -26], size: [10, 22], flat: 0.45 });
  harbour.add(near.inst, sea.inst);

  const gulls = Array.from({ length: 6 }, (_, i) => {
    const bird = gull();
    bird.userData.orbit = { r: 9 + rand() * 14, h: 4 + rand() * 7, speed: 0.15 + rand() * 0.15, phase: rand() * 6.28, cx: (rand() - 0.5) * 10, cz: -16 + (rand() - 0.5) * 10, dir: i % 2 ? 1 : -1 };
    harbour.add(bird);
    return bird;
  });

  const booths = dressLockers(world, harbour);

  // Everything that never moves becomes a few big meshes, one per
  // material: hundreds of flowers, leaves and beams cost a few draws.
  const live = booths.flatMap((b) => {
    const parts = [b.prop, ...b.doors.map((d) => d.hinge)];
    b.prop.parent.traverse((o) => o.isMesh && (Object.values(b.tone).includes(o.material) || o.material === b.lamp.material) && parts.push(o));
    return parts;
  });
  bake(harbour, new Set([...gulls, flag, pennant, near.inst, sea.inst, beacon.lamp, ...lanterns, ...live]));

  const dome = skyDome();
  scene.add(dome);

  world.harbour = { group: harbour, near, sea, gulls, flags: [flag, pennant], lanterns, beacon, dome, booths };
  return world.harbour;
}

export function bake(root, keep) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map(); // material -> { geometries, cast }
  const doomed = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.isShaderMaterial) return;
    for (let p = o; p && p !== root; p = p.parent) if (keep.has(p)) return;
    const material = o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal' || (name === 'color' && material.vertexColors) || (name === 'uv' && material.map)) continue;
      g.deleteAttribute(name);
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    const key = `${material.uuid}|${o.castShadow}`;
    if (!buckets.has(key)) buckets.set(key, { material, cast: o.castShadow, geometries: [] });
    buckets.get(key).geometries.push(g);
    doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();
  for (const { material, cast, geometries } of buckets.values()) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = cast;
    m.receiveShadow = true;
    m.userData.shadowSet = true;
    m.raycast = () => {};
    root.add(m);
  }
  // groups left empty by the merge
  const empty = [];
  root.traverse((o) => o !== root && o.isGroup && o.children.length === 0 && empty.push(o));
  empty.forEach((o) => o.removeFromParent());
}

// The Blender dock's own pieces: warmer, livelier colours.
function restyleModel(model) {
  if (!model) return;
  const tint = {
    col_rail: '#e6b981',
    rail_: '#8a5634',
    dock_pillar: '#7a4f31',
    bench_: '#c98b52',
    lamp_post: '#3e4a5c',
    flag_pole: '#e7d9c2',
    route_board_post: '#8a5634',
    room_board_leg: '#8a5634',
    station_dock_bell_post: '#8a5634',
    prop_crate: '#cf9358',
    prop_barrel: '#b46f3d',
  };
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const [prefix, color] of Object.entries(tint)) {
      if (o.name.startsWith(prefix)) {
        o.material.color.set(color);
        if (!o.material.map) o.material.map = woodGrain();
        o.material.needsUpdate = true;
      }
    }
    if (o.name.startsWith('lamp_bulb')) o.castShadow = false;
  });
}


// --- the uniform booths ---------------------------------------------------------

// The role's symbol, painted on a round badge: a wrench, a lightning bolt,
// a ship's wheel. Dark ink on cream, so it reads in any colour palette.
function badgeTexture(role) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff4dc';
  g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  g.fillStyle = g.strokeStyle = '#2a2f4a';
  g.lineCap = g.lineJoin = 'round';
  if (role === 'mechanic') {
    g.rotate(-Math.PI / 4);
    g.lineWidth = 34;
    g.beginPath();
    g.moveTo(0, -40);
    g.lineTo(0, 78);
    g.stroke();
    g.beginPath();
    g.arc(0, -62, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff4dc';
    g.fillRect(-15, -112, 30, 50); // the jaw's opening
  } else if (role === 'engineer') {
    g.beginPath();
    for (const [x, y] of [[18, -100], [-52, 14], [-6, 14], [-22, 100], [56, -20], [8, -20], [34, -100]]) g.lineTo(x, y);
    g.closePath();
    g.fill();
  } else {
    g.lineWidth = 16;
    g.beginPath();
    g.arc(0, 0, 62, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 16, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
      g.lineTo(Math.cos(a) * 100, Math.sin(a) * 100);
      g.stroke();
      g.beginPath();
      g.arc(Math.cos(a) * 100, Math.sin(a) * 100, 11, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function nameTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 120;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3b2516';
  g.fillRect(0, 0, 640, 120);
  g.strokeStyle = '#c8924f';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 624, 104);
  g.fillStyle = '#fff1c9';
  g.font = '900 78px "Lilita One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 320, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// What stands on each roof.
function roofProp(role) {
  const g = new THREE.Group();
  const brass = paint('#e2b84a', { rough: 0.35 });
  if (role === 'mechanic') {
    // a gear, standing up
    const gear = new THREE.Group();
    gear.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20).rotateX(Math.PI / 2), brass));
    for (let i = 0; i < 10; i++) {
      const tooth = mesh(new THREE.BoxGeometry(0.08, 0.09, 0.08), brass);
      const a = (i / 10) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.23, Math.sin(a) * 0.23, 0);
      tooth.rotation.z = a;
      gear.add(tooth);
    }
    gear.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12).rotateX(Math.PI / 2), paint('#5d5a66', { rough: 0.5 })));
    gear.position.y = 0.3;
    gear.rotation.y = Math.PI / 2;
    g.add(gear);
    g.userData.spin = gear;
  } else if (role === 'engineer') {
    // a glowing bulb on a brass base, and a little bolt beside it
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12), brass, 0, 0.06, 0));
    const bulb = mesh(new THREE.SphereGeometry(0.13, 16, 12), paint('#fff3b0', { emissive: '#ffd84d', glow: 0.9, rough: 0.2 }), 0, 0.24, 0, { shadow: false });
    bulb.material = bulb.material.clone();
    g.add(bulb);
    g.userData.bulb = bulb;
    const shape = new THREE.Shape();
    [[0.04, 0.2], [-0.07, 0.02], [0, 0.02], [-0.03, -0.18], [0.09, 0.03], [0.02, 0.03], [0.07, 0.2]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    // a bolt either side of the bulb, mirror images
    for (const side of [-1, 1]) {
      const bolt = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }).translate(-0.01, 0, -0.02), paint('#ffd84d', { emissive: '#ffb020', glow: 0.3 }), 0, 0.26, side * 0.28);
      bolt.rotation.y = -Math.PI / 2;
      bolt.scale.x = side;
      g.add(bolt);
    }
  } else {
    // a ship's wheel
    const wheel = new THREE.Group();
    const wood = paint('#a0632f');
    wheel.add(mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), wood));
    wheel.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12).rotateX(Math.PI / 2), brass));
    for (let i = 0; i < 8; i++) {
      const spoke = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.56, 6), wood);
      spoke.rotation.z = (i / 4) * Math.PI; // 4 rods through the hub: 8 even spokes, 45° apart
      if (i < 4) wheel.add(spoke);
      const knob = mesh(new THREE.SphereGeometry(0.03, 8, 6), wood);
      const a = (i / 8) * Math.PI * 2;
      knob.position.set(Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0);
      wheel.add(knob);
    }
    wheel.position.y = 0.33;
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    g.userData.spin = wheel;
  }
  return g;
}

const ROLE_NAMES = { mechanic: 'MECHANIC', engineer: 'ENGINEER', pilot: 'PILOT' };

// Each uniform locker becomes a little booth. The locker mesh stays (the
// game colours it, aims at it and bumps into it); its painted-on doors,
// plate and flat lid make way for real ones, and every coloured part
// follows the locker's colour, so palettes and the taken look still work.
function dressLockers(world, root) {
  const booths = [];
  for (const locker of world.lockers ?? []) {
    const role = locker.userData.takes;
    for (const part of ['door_line', 'handle', 'nameplate', 'roof']) {
      const old = locker.parent?.getObjectByName(`${locker.name}_${part}`);
      if (old) old.visible = false;
    }
    // rounded body, same size and place
    const geo = locker.geometry;
    geo.computeBoundingBox();
    const local = geo.boundingBox;
    const size = local.getSize(new THREE.Vector3());
    const mid = local.getCenter(new THREE.Vector3());
    locker.geometry = new RoundedBoxGeometry(size.x, size.y, size.z, 3, Math.min(size.x, size.y, size.z) * 0.06).translate(mid.x, mid.y, mid.z);

    const box = new THREE.Box3().setFromObject(locker);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const front = box.min.x; // the booths face the dock, towards -x
    const width = s.z;
    const top = box.max.y;
    const g = new THREE.Group();

    const tone = {
      door: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
      panel: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      roof: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
      trim: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      mat: new THREE.MeshStandardMaterial({ roughness: 1 }),
    };
    const add = (m) => {
      m.userData.shadowSet = true;
      g.add(m);
      return m;
    };

    // base: a stone step and a doormat
    add(mesh(new RoundedBoxGeometry(s.x + 0.24, 0.14, width + 0.24, 2, 0.03), paint('#9b8aa8', { rough: 0.95 }), c.x, DOCK.top + 0.07, c.z));
    add(mesh(new RoundedBoxGeometry(0.5, 0.03, width * 0.8, 2, 0.01), tone.mat, front - 0.42, DOCK.top + 0.015, c.z, { shadow: false }));

    // double doors with raised panels and brass knobs
    const doorH = s.y * 0.6; // room above for the name board, under the badge
    const doorY = DOCK.top + 0.14 + doorH / 2 + 0.04;
    // Each door hangs on a hinge at its outer edge, so it can swing open.
    const doors = [];
    for (const side of [-1, 1]) {
      const hingeZ = c.z + side * (width * 0.455);
      const hinge = new THREE.Group();
      hinge.position.set(front - 0.02, doorY, hingeZ);
      const dz = side * (width * 0.235) - side * (width * 0.455); // door centre, from the hinge
      const part = (m) => {
        m.userData.shadowSet = true;
        hinge.add(m);
      };
      part(mesh(new RoundedBoxGeometry(0.05, doorH, width * 0.44, 2, 0.015), tone.door, 0, 0, dz));
      for (const py of [0.24, -0.2]) part(mesh(new RoundedBoxGeometry(0.03, doorH * 0.32, width * 0.3, 2, 0.01), tone.panel, -0.03, py * doorH, dz));
      part(mesh(new THREE.SphereGeometry(0.04, 10, 8), paint('#e2b84a', { rough: 0.3 }), -0.06, 0, side * 0.07 - side * (width * 0.455)));
      g.add(hinge);
      doors.push({ hinge, side });
    }
    // the dark inside, one piece the width of both doors (no post down the
    // middle), seen only while the doors stand open
    g.add(mesh(new THREE.BoxGeometry(0.02, doorH * 0.96, width * 0.9), paint('#2a1c14'), front - 0.003, doorY, c.z, { shadow: false }));
    // trim round the front
    const trimT = 0.06;
    add(mesh(new THREE.BoxGeometry(0.05, trimT, width + 0.04), tone.trim, front - 0.02, doorY + doorH / 2 + trimT / 2, c.z));
    for (const side of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.05, s.y, trimT), tone.trim, front - 0.02, c.y, c.z + side * (width / 2 - trimT / 2)));

    // badge with the role's symbol, and the name board above the doors
    const badgeY = top - 0.24;
    const ring = add(mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.05, 28).rotateZ(Math.PI / 2), tone.trim, front - 0.04, badgeY, c.z));
    ring.scale.set(1, 1, 1);
    const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTexture(role), roughness: 0.6 });
    const badge = add(mesh(new THREE.CircleGeometry(0.19, 28), badgeMat, front - 0.075, badgeY, c.z, { shadow: false }));
    badge.rotation.y = -Math.PI / 2;
    // the name board: on the front, between the doors and the badge, square
    // to the dock and clear of the roof, so it reads from across the planks
    const nameY = doorY + doorH / 2 + 0.13;
    const nameMat = new THREE.MeshStandardMaterial({ map: nameTexture(ROLE_NAMES[role] ?? role.toUpperCase()), roughness: 0.8 });
    const board = add(mesh(new THREE.PlaneGeometry(width * 0.9, width * 0.17), nameMat, front - 0.081, nameY, c.z, { shadow: false }));
    board.rotation.y = -Math.PI / 2;
    add(mesh(new THREE.BoxGeometry(0.05, width * 0.18, width * 0.92), paint('#5b3a22'), front - 0.05, nameY, c.z));

    // pitched roof with an overhang, ridge running along the dock
    const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
    roofGeo.rotateX(Math.PI / 2);
    roofGeo.rotateZ(Math.PI / 2 + Math.PI);
    const roof = add(mesh(roofGeo, tone.roof, c.x - 0.04, top + 0.3, c.z));
    roof.scale.set(0.62, 0.45, width + 0.3);
    roof.position.y = top + 0.23;
    add(mesh(new THREE.BoxGeometry(s.x + 0.3, 0.06, width + 0.32), paint('#5b3a22'), c.x - 0.04, top + 0.02, c.z));

    // a lamp on a bracket, lit while the uniform is free
    // a lamp on a bracket each side of the badge, lit while the uniform is free
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff1c4', emissive: '#ffcc66', emissiveIntensity: 1.2 });
    for (const side of [-1, 1]) {
      const lampZ = c.z + side * (width / 2 - 0.02);
      add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), paint('#3e4a5c'), front - 0.09, badgeY + 0.06, lampZ));
      add(mesh(new THREE.ConeGeometry(0.07, 0.06, 12), paint('#3e4a5c'), front - 0.17, badgeY + 0.05, lampZ));
      add(mesh(new THREE.SphereGeometry(0.055, 12, 10), lampMat, front - 0.17, badgeY - 0.01, lampZ, { shadow: false }));
    }
    const lamp = { material: lampMat };

    // the role's prop on the roof
    const prop = roofProp(role);
    prop.position.set(c.x - 0.04, top + 0.42, c.z);
    prop.traverse((o) => o.isMesh && (o.userData.shadowSet = true));
    g.add(prop);

    root.add(g);
    booths.push({
      locker,
      tone,
      lamp,
      prop,
      doors,
      mouth: new THREE.Vector3(front - 0.15, doorY + 0.2, c.z), // where the confetti comes out
      color: role,
      root: g,
      shade: null, // 0 free .. 1 taken, eased; null until first seen
      taken: null,
      since: -1, // when it was last taken (or freed)
      burst: null,
    });
  }
  return booths;
}

const _base = new THREE.Color();
const _white = new THREE.Color('#ffffff');
const _grey = new THREE.Color('#7a7a88');
const _tmp = new THREE.Color();
// Every frame: the booth's coloured parts follow its locker's colour (free,
// taken, or the colour-blind palette); its lamp is lit while it is free.
// --- the take-a-uniform animation ------------------------------------------------
//
// When a uniform is taken, its booth plays a little show, the same on every
// screen (each works it out from the uniform being taken):
//   0.00 s  the doors swing open, the roof prop hops and whirls
//   0.10 s  a burst of confetti out of the doorway, with a chime
//   0.75 s  the doors swing shut, with a clunk
//   0.90 s  the booth fades to its taken grey, the lamps go out
// Put back, the booth brightens again with a little hop of its prop.
const OPEN = 0.25;
const SHUT_AT = 0.75;
const SHUT = 0.25;
const FADE_AT = 0.9;
const FADE = 0.6;
const ease = (x) => 1 - (1 - x) ** 3;

let confettiGeo = null;
const CONFETTI = 36;
function burst(b, now) {
  confettiGeo ??= new THREE.PlaneGeometry(0.06, 0.035);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const inst = new THREE.InstancedMesh(confettiGeo, material, CONFETTI);
  inst.frustumCulled = false;
  inst.raycast = () => {};
  inst.userData.shadowSet = true;
  const colors = [new THREE.Color(b.locker.userData.freeColor ?? b.locker.material.color), new THREE.Color('#ffd84d'), new THREE.Color('#ffffff')];
  const bits = Array.from({ length: CONFETTI }, (_, i) => {
    inst.setColorAt(i, colors[i % 3]);
    const a = Math.random() * Math.PI * 2;
    const spread = 0.6 + Math.random() * 1.2;
    return {
      p: b.mouth.clone(),
      v: new THREE.Vector3(-(1.4 + Math.random() * 1.8), 2 + Math.random() * 2.2, Math.cos(a) * spread),
      spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
    };
  });
  b.root.add(inst);
  b.burst = { inst, bits, born: now };
}

const _e = new THREE.Euler();
function updateBurst(b, now, dt) {
  const f = b.burst;
  if (!f) return;
  const age = (now - f.born) / 1000;
  if (age > 1.6) {
    f.inst.removeFromParent();
    f.inst.dispose();
    f.inst.material.dispose();
    b.burst = null;
    return;
  }
  const shrink = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.5;
  f.bits.forEach((bit, i) => {
    bit.v.y -= 6 * dt;
    bit.v.multiplyScalar(1 - 1.5 * dt); // air
    bit.p.addScaledVector(bit.v, dt);
    bit.p.y = Math.max(bit.p.y, DOCK.top + 0.02); // they settle on the planks
    _e.set(bit.r.x + bit.spin.x * age, bit.r.y + bit.spin.y * age, bit.r.z + bit.spin.z * age);
    _m.compose(bit.p, _q.setFromEuler(_e), _s.setScalar(Math.max(0.001, shrink)));
    f.inst.setMatrixAt(i, _m);
  });
  f.inst.instanceMatrix.needsUpdate = true;
  f.inst.material.opacity = Math.min(1, shrink * 1.5);
}

// sound: (name, volume) to play a sound; now in ms, dt in s, t in s.
function updateBooths(booths, { t, dt, now, sound }) {
  for (const b of booths) {
    const taken = !!b.locker.userData.label?.visible;
    if (b.taken === null) {
      b.taken = taken; // first sight: no show for uniforms already on
      b.shade = taken ? 1 : 0;
    } else if (taken !== b.taken) {
      b.taken = taken;
      b.since = now;
      if (taken) {
        burst(b, now);
        sound('ui_ping_chime', 0.45);
        b.clunked = false;
      }
    }
    const age = b.since < 0 ? Infinity : (now - b.since) / 1000;

    // the doors: open, hold, shut (only for a take)
    let open = 0;
    if (taken && age < SHUT_AT + SHUT) open = age < OPEN ? ease(age / OPEN) : age < SHUT_AT ? 1 : 1 - ease((age - SHUT_AT) / SHUT);
    if (taken && !b.clunked && age >= SHUT_AT + SHUT) {
      b.clunked = true;
      if (age < SHUT_AT + SHUT + 0.3) sound('engineer_lever_clunk', 0.35);
    }
    for (const d of b.doors) d.hinge.rotation.y = d.side * open * 1.75;

    // colour: eases to the taken grey once the doors have shut, and back
    const target = taken ? 1 : 0;
    const waiting = taken && age < FADE_AT;
    if (!waiting) b.shade += Math.sign(target - b.shade) * Math.min(Math.abs(target - b.shade), dt / FADE);
    _base.copy(b.locker.userData.freeColor ?? b.locker.material.color);
    _tmp.copy(_base).lerp(_grey, 0.55).multiplyScalar(0.55);
    _base.lerp(_tmp, b.shade);
    b.locker.material.color.copy(_base);
    b.tone.door.color.copy(_base).multiplyScalar(0.92);
    b.tone.panel.color.copy(_base).lerp(_white, 0.18);
    b.tone.roof.color.copy(_base).multiplyScalar(0.62);
    b.tone.trim.color.copy(_base).lerp(_white, 0.55 - 0.3 * b.shade);
    b.tone.mat.color.copy(_base).multiplyScalar(0.7);

    // lamps: flare while the doors are open, then fade with the colour
    const flare = taken && age < SHUT_AT ? 1.2 : 0;
    b.lamp.material.emissiveIntensity = (1 - b.shade) * (1.2 + Math.sin(t * 3) * 0.2) + flare;

    // the roof prop: hops and whirls on a take, a small hop when freed
    const hop = age < 0.6 ? Math.sin((age / 0.6) * Math.PI) * (taken ? 0.25 : 0.12) : 0;
    b.prop.position.y = (b.prop.userData.restY ??= b.prop.position.y) + hop;
    const spin = b.prop.userData.spin;
    if (spin) {
      const whirl = taken && age < 1.2 ? 14 * (1 - age / 1.2) : 0;
      spin.rotation.z += ((1 - b.shade) * 0.8 + whirl) * dt;
    }
    const bulb = b.prop.userData.bulb;
    if (bulb) bulb.material.emissiveIntensity = taken && age < 1 ? 2.5 * (1 - age) + 0.05 : 0.05 + (1 - b.shade) * (0.75 + Math.sin(t * 5) * 0.25);

    updateBurst(b, now, dt);
  }
}

// --- every frame -----------------------------------------------------------

const DOCK_SKY = {
  top: new THREE.Color('#3f8fe0'),
  horizon: new THREE.Color('#cfe8fb'),
  bottom: new THREE.Color('#eef5ff'),
};

// fair: 1 at the dock in good weather, 0 in the storm (main.js eases it).
export function updateHarbour(world, camera, { dt, t, fair, lampsOn, sound = () => {} }) {
  const h = world.harbour;
  if (!h) return;
  camera.getWorldPosition(h.dome.position);
  const u = h.dome.material.uniforms;
  u.sunAmount.value = fair;
  if (!world.dock.visible) return;
  updateBooths(h.booths, { t, dt, now: t * 1000, sound });
  // sunlit white in the harbour, storm-grey as she climbs into the weather
  h.near.inst.material.emissiveIntensity = 0.1 + 0.45 * fair;
  h.sea.inst.material.emissiveIntensity = 0.1 + 0.45 * fair;

  // Clouds drift with the wind; the sea below more slowly.
  placeClouds(h.near, t * 0.6);
  placeClouds(h.sea, t * 0.25);

  for (const bird of h.gulls) {
    const o = bird.userData.orbit;
    const a = o.phase + t * o.speed * o.dir;
    bird.position.set(o.cx + Math.cos(a) * o.r, o.h + Math.sin(t * 0.7 + o.phase) * 0.8, o.cz + Math.sin(a) * o.r);
    bird.rotation.y = -a - (o.dir > 0 ? 0 : Math.PI);
    const flap = Math.sin(t * 9 + o.phase) * 0.6;
    bird.userData.wings[0].rotation.x = -flap;
    bird.userData.wings[1].rotation.x = flap;
  }

  for (const flag of h.flags) {
    const p = flag.geometry.attributes.position;
    const rest = flag.userData.rest;
    for (let i = 0; i < p.count; i++) {
      const x = rest[i * 3];
      p.setZ(i, Math.sin(x * 4 - t * 6) * 0.12 * x);
    }
    p.needsUpdate = true;
    flag.geometry.computeVertexNormals();
  }

  for (const lantern of h.lanterns) lantern.material.emissiveIntensity = lampsOn ? 1.6 : 0.35;
  h.beacon.lamp.material.emissiveIntensity = 1 + Math.max(0, Math.sin(t * 2)) * 1.5;
}

export { DOCK_SKY };
