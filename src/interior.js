// The look of the cabin: painted planks on the walls, the floors and the
// ceiling (mapped at a real scale, so a board is the same size on every
// wall), skirting boards and a moulding at the ceiling, panelling with a
// rail on the lower walls of the power room and the helm, wood grain on
// the rooms' wooden furniture, and warmer pools of lamplight.
//
// Only looks: no collider, station or rule changes here. The room floors
// keep their palette colour (the plank texture is light, and tinted by it).

import * as THREE from 'three';
import { ROOMS, ROOM_HALF, SHIP, GANGPLANK } from './world.js';

// --- textures -----------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 12)) >>> 0) / 4294967296;
  };
}

function texture(canvas, repeatable = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeatable) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Boards running across the canvas: `count` of them, each its own shade,
// with grain, a seam between, end joints and a nail at each joint.
// base: [r, g, b] 0..255; spread: how much boards differ.
function boards(width, height, count, base, spread, seed, { joints = 2, nails = true, light = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const rand = rng(seed);
  const h = height / count;
  for (let i = 0; i < count; i++) {
    const y = i * h;
    // a board may be in two or three lengths, joints staggered
    const cuts = [0];
    for (let j = 0; j < joints; j++) cuts.push(((j + 0.3 + rand() * 0.4) / joints) * width);
    cuts.push(width);
    for (let k = 0; k < cuts.length - 1; k++) {
      const shade = 1 + (rand() - 0.5) * spread;
      const [r, gg, b] = base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade))));
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(cuts[k], y, cuts[k + 1] - cuts[k], h);
      // grain: long wavy lines along the board
      for (let n = 0; n < 7; n++) {
        const gy = y + 2 + rand() * (h - 4);
        g.strokeStyle = light ? `rgba(120, 90, 60, ${0.06 + rand() * 0.08})` : `rgba(40, 20, 8, ${0.08 + rand() * 0.12})`;
        g.lineWidth = 0.6 + rand() * 1.4;
        g.beginPath();
        g.moveTo(cuts[k], gy);
        for (let x = cuts[k]; x <= cuts[k + 1]; x += 24) g.lineTo(x, gy + Math.sin(x / 40 + n + i) * 1.4);
        g.stroke();
      }
      if (rand() < 0.25) {
        g.fillStyle = light ? 'rgba(110, 75, 45, 0.18)' : 'rgba(30, 14, 4, 0.3)';
        g.beginPath();
        g.ellipse(cuts[k] + rand() * (cuts[k + 1] - cuts[k]), y + h / 2, 5 + rand() * 6, 2 + rand() * 2, 0, 0, Math.PI * 2);
        g.fill();
      }
      // the end joint and its nails
      g.fillStyle = light ? 'rgba(70, 45, 25, 0.45)' : 'rgba(20, 10, 4, 0.55)';
      g.fillRect(cuts[k], y, 2, h);
      if (nails) {
        g.fillStyle = 'rgba(30, 30, 36, 0.55)';
        for (const ny of [y + h * 0.28, y + h * 0.72]) {
          g.beginPath();
          g.arc(cuts[k] + 6, ny, 1.8, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // the seam under each board, and a lit edge on top: reads as relief
    g.fillStyle = light ? 'rgba(60, 40, 25, 0.5)' : 'rgba(15, 7, 2, 0.65)';
    g.fillRect(0, y + h - 3, width, 3);
    g.fillStyle = 'rgba(255, 235, 200, 0.12)';
    g.fillRect(0, y, width, 2);
  }
  return texture(canvas);
}

let made = null;
function textures() {
  made ??= {
    // walls: boards 0.25 m tall; one tile is 2 m by 1 m
    wall: boards(512, 256, 4, [150, 98, 60], 0.22, 3),
    // panels on the lower walls: narrower, darker, vertical
    panel: boards(256, 512, 6, [112, 70, 42], 0.16, 5, { joints: 0, nails: false }),
    // floors: light planks tinted by the room colour; one tile is 2 m by 2 m
    floor: boards(512, 512, 10, [236, 230, 222], 0.12, 7, { light: true }),
    // the bare deck between rooms (under the doors)
    deck: boards(512, 512, 10, [176, 122, 76], 0.2, 9),
    // ceiling boards
    ceiling: boards(512, 256, 5, [120, 78, 48], 0.2, 11, { nails: false }),
  };
  return made;
}

// UVs from where each face is in the ship, in metres, so the texture's
// scale is the same on every wall whatever its size. tile: metres per
// repeat [u, v]. vertical: boards run along v on walls (panels).
function worldUV(mesh, tile, { vertical = false } = {}) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  mesh.updateMatrixWorld(true);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const toShip = mesh.matrixWorld; // the ship stands at the origin when this runs
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toShip);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toShip);
    n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
    let u;
    let v;
    if (Math.abs(n.y) > 0.7) {
      u = p.x;
      v = p.z;
    } else if (Math.abs(n.z) > 0.7) {
      u = p.x;
      v = p.y;
    } else {
      u = p.z;
      v = p.y;
    }
    if (vertical) [u, v] = [v, u];
    uv[i * 2] = u / tile[0];
    uv[i * 2 + 1] = v / tile[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  mesh.geometry = g;
}

// --- the hull -------------------------------------------------------------------------

const WALL = SHIP.width / 2 - SHIP.thickness / 2;

export function styleInterior(world) {
  const t = textures();
  const { wood, deck } = world.hullMaterials;
  wood.map = t.wall;
  wood.color.set('#ffffff');
  wood.flatShading = false;
  wood.roughness = 0.85;
  wood.needsUpdate = true;
  deck.map = t.deck;
  deck.color.set('#ffffff');
  deck.needsUpdate = true;
  const ceilingMat = new THREE.MeshStandardMaterial({ map: t.ceiling, roughness: 0.9 });

  world.ship.traverse((o) => {
    if (!o.isMesh || o.parent !== world.ship) return;
    if (o.material === wood) {
      const top = new THREE.Box3().setFromObject(o);
      // the ceiling slab: its own boards
      if (top.min.y > SHIP.wallHeight - 0.05 && top.max.x - top.min.x > 10) o.material = ceilingMat;
      worldUV(o, [2, 1]);
    } else if (o.material === deck) {
      worldUV(o, [2, 2]);
    }
  });
  for (const mats of Object.values(world.roomMaterials ?? {})) {
    mats.inlay.map = t.floor;
    mats.inlay.flatShading = false;
    mats.inlay.roughness = 0.8;
    mats.inlay.needsUpdate = true;
  }
  world.ship.traverse((o) => {
    if (o.isMesh && Object.values(world.roomMaterials ?? {}).some((m) => m.inlay === o.material)) worldUV(o, [2, 2]);
  });

  // trim: skirting boards and a ceiling moulding round every room, and
  // panelling with a rail on the lower walls of the power room and helm
  const trim = new THREE.Group();
  trim.name = 'cabinTrim';
  const skirt = new THREE.MeshStandardMaterial({ color: '#3f2414', roughness: 0.7 });
  const mould = new THREE.MeshStandardMaterial({ color: '#5a341d', roughness: 0.7 });
  const rail = new THREE.MeshStandardMaterial({ color: '#d2a25a', roughness: 0.45 });
  const panelMat = new THREE.MeshStandardMaterial({ map: t.panel, roughness: 0.75 });
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.raycast = () => {};
    m.receiveShadow = true;
    trim.add(m);
    return m;
  };
  const end = SHIP.length / 2 - SHIP.thickness / 2;
  const doorGap = SHIP.doorWidth / 2;
  const cargoGap = GANGPLANK.halfWidth;

  // runs along the side walls, broken at the cargo door
  const sideRuns = (side) => {
    const runs = [];
    if (side < 0) {
      runs.push([-end, -cargoGap], [cargoGap, end]);
    } else runs.push([-end, end]);
    return runs;
  };
  for (const side of [-1, 1]) {
    for (const [a, b] of sideRuns(side)) {
      const len = b - a;
      const cx = (a + b) / 2;
      add(new THREE.BoxGeometry(len, 0.14, 0.04), skirt, cx, 0.07, side * (WALL - 0.02));
      add(new THREE.BoxGeometry(len, 0.1, 0.06), mould, cx, SHIP.wallHeight - 0.06, side * (WALL - 0.03));
    }
  }
  // the bulkheads and the end walls, each side of the doorways
  const across = [
    { x: -end, faces: [1] },
    { x: end, faces: [-1] },
    { x: -ROOM_HALF, faces: [-1, 1], door: true },
    { x: ROOM_HALF, faces: [-1, 1], door: true },
  ];
  for (const w of across) {
    for (const f of w.faces) {
      const fx = w.x + f * (SHIP.thickness / 2 + 0.02);
      const spans = w.door ? [[-WALL, -doorGap], [doorGap, WALL]] : [[-WALL, WALL]];
      for (const [a, b] of spans) {
        add(new THREE.BoxGeometry(0.04, 0.14, b - a), skirt, fx, 0.07, (a + b) / 2);
        add(new THREE.BoxGeometry(0.06, 0.1, b - a), mould, fx + f * 0.01, SHIP.wallHeight - 0.06, (a + b) / 2);
      }
    }
  }
  // panelling up to a rail, in the power room and at the helm
  for (const room of ROOMS) {
    if (room.id === 'engine') continue; // the engine room has iron plates
    const a = room.x - ROOM_HALF + SHIP.thickness / 2;
    const b = room.x + ROOM_HALF - SHIP.thickness / 2 - (room.id === 'helm' ? 0 : 0);
    const roomEnd = room.id === 'helm' ? end : b;
    for (const side of [-1, 1]) {
      const spans = side < 0 && room.id === 'power' ? [[a, -cargoGap], [cargoGap, roomEnd]] : [[a, roomEnd]];
      for (const [p, q] of spans) {
        const panel = add(new THREE.BoxGeometry(q - p, 0.86, 0.025), panelMat, (p + q) / 2, 0.57, side * (WALL - 0.013));
        worldUV(panel, [0.5, 1], { vertical: true });
        add(new THREE.BoxGeometry(q - p, 0.05, 0.07), rail, (p + q) / 2, 1.02, side * (WALL - 0.035));
      }
    }
  }
  world.ship.add(trim);
}

// --- the rooms' furniture -----------------------------------------------------------

// Wooden-looking pieces (warm brown, matt) get the grain; metal and paint
// stay as they are.
const _hsl = {};
let grain = null;
export function styleRoomModel(model) {
  grain ??= boards(256, 256, 4, [255, 255, 255], 0.0, 21, { joints: 0, nails: false, light: true });
  model.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.map) return;
    const m = o.material;
    m.color.getHSL(_hsl);
    const brown = _hsl.h > 0.03 && _hsl.h < 0.13 && _hsl.s > 0.25 && _hsl.l > 0.12 && _hsl.l < 0.65 && (m.roughness ?? 1) > 0.55 && !(m.emissiveIntensity > 0.2 && m.emissive?.getHex());
    if (!brown) return;
    m.map = grain;
    m.flatShading = false;
    m.needsUpdate = true;
  });
  // room lamps: a bit brighter and warmer, for pools of light
  model.traverse((o) => {
    if (o.isPointLight) {
      o.intensity *= 1.6;
      o.distance = Math.max(o.distance, 7);
    }
  });
}
