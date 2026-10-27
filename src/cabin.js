// Details inside the ship, now the rooms are 10 m long: hull ribs down the
// walls, and things that make each room its job's own. Pipes, gauges and
// hazard stripes in the engine room; cables, a fan, blinking lights and a
// chalkboard in the power room; portholes, a chart, books, a globe and a
// lantern at the helm.
//
// All of it is scenery: the interact ray goes through it, and only the
// few things standing on the floor (in corners, clear of every station,
// hole, fire and grapple spot, and of the walkways between the doors)
// get a box the crew bumps into.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HOOK_SPOTS, ROOM_HALF, SHIP } from './world.js';
import { bake, mesh, paint, seeded } from './harbour.js';

const WALL = SHIP.width / 2 - SHIP.thickness / 2; // inner face of the side walls (z)
const BULK = ROOM_HALF + SHIP.thickness / 2; // the bulkheads' faces on the engine-room and helm sides (x)
const INNER = ROOM_HALF - SHIP.thickness / 2; // and on the power-room side
const END = SHIP.length / 2 - SHIP.thickness / 2; // stern and bow faces (x)

const IRON = '#4d5566';
const BRASS = '#d9a441';

// A board with painted words (and an optional drawing), both readable and cheap.
function board(width, height, draw, { bg = '#2f3b2f', frame = '#7a4f31' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  draw(g, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  group.add(mesh(new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.04), paint(frame), 0, 0, -0.03));
  group.add(mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }), 0, 0, 0, { shadow: false }));
  return group;
}

const text = (g, words, x, y, size, color = '#fff4dc', align = 'center') => {
  g.fillStyle = color;
  g.font = `900 ${size}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(words, x, y);
};

// Put a group flat against a wall, facing into the room.
// side: 'port' (z = -WALL, faces +z), 'starboard' (z = +WALL, faces -z),
// 'stern' / 'bow' / 'bulkL' / 'bulkR' for walls across the ship.
function onWall(object, side, along, y, out = 0.02) {
  if (side === 'port') {
    object.position.set(along, y, -WALL + out);
    object.rotation.y = 0;
  } else if (side === 'starboard') {
    object.position.set(along, y, WALL - out);
    object.rotation.y = Math.PI;
  } else {
    // a wall across the ship at x = side value; faces the room on the other side
    const { x, facing } = side;
    object.position.set(x + facing * out, y, along);
    object.rotation.y = facing * (Math.PI / 2);
  }
  return object;
}

function gauge(radius) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 20).rotateX(Math.PI / 2), paint(BRASS, { rough: 0.35 }), 0, 0, 0.03));
  g.add(mesh(new THREE.CircleGeometry(radius * 0.82, 20), paint('#fff4dc'), 0, 0, 0.065, { shadow: false }));
  const red = mesh(new THREE.RingGeometry(radius * 0.55, radius * 0.75, 16, 1, -0.5, 0.9), paint('#e2574c', { side: THREE.DoubleSide }), 0, 0, 0.067, { shadow: false });
  g.add(red);
  const needle = new THREE.Group();
  needle.position.z = 0.07;
  needle.add(mesh(new THREE.BoxGeometry(0.012, radius * 0.7, 0.01), paint('#22263a'), 0, radius * 0.33, 0, { shadow: false }));
  g.add(needle);
  g.userData.needle = needle;
  return g;
}

// --- everywhere: hull ribs ------------------------------------------------------

// Wall spans already taken by the rooms' own furniture (from the Blender
// rooms as fitted into the 10 m rooms): no rib behind a lamp or a chart.
const BUSY = {
  port: [[-14.9, -13.7], [-10.3, -9.7], [-4.7, -3.2], [1.6, 2.5], [3.9, 4.7], [6.9, 8.7], [10.9, 11.7], [13.2, 13.8]],
  starboard: [[-14.9, -14], [-10.95, -9.05], [-7.8, -5.2], [-4.8, -3.1], [-2.2, 2.2], [7.75, 8.25], [8.95, 11.3], [11.75, 12.25], [13.7, 14.9]],
};

function ribs(root) {
  const wood = paint('#6e4529');
  const hookXs = { port: HOOK_SPOTS.map((h) => h.port), starboard: HOOK_SPOTS.map((h) => h.starboard) };
  for (const side of ['port', 'starboard']) {
    for (let x = -END + 1.2; x <= END - 1.2; x += 2.4) {
      if (Math.abs(Math.abs(x) - ROOM_HALF) < 0.5) continue; // bulkheads
      if (side === 'port' && Math.abs(x) < SHIP.doorWidth / 2 + 0.3) continue; // the cargo door
      if (hookXs[side].some((h) => Math.abs(h - x) < 0.55)) continue; // grapples bite here
      if (BUSY[side].some(([a, b]) => x > a - 0.12 && x < b + 0.12)) continue; // furniture on the wall
      const rib = mesh(new RoundedBoxGeometry(0.16, 2.4, 0.09, 2, 0.03), wood);
      root.add(onWall(rib, side, x, 1.25, 0.045));
    }
  }
}

// --- the engine room --------------------------------------------------------------

function engineRoom(root, live, colliders) {
  const x0 = -END;
  const x1 = -BULK;
  // riveted iron plates along the lower walls
  const plate = paint('#5b6272', { rough: 0.55 });
  const rivet = new THREE.SphereGeometry(0.018, 6, 4);
  const rivetPaint = paint('#8a92a3', { rough: 0.4 });
  for (const side of ['port', 'starboard']) {
    for (let x = x0 + 0.6; x < x1 - 0.4; x += 1.2) {
      const p = new THREE.Group();
      p.add(mesh(new THREE.BoxGeometry(1.16, 0.7, 0.025), plate));
      for (const rx of [-0.52, 0.52]) for (const ry of [-0.29, 0.29]) p.add(mesh(rivet, rivetPaint, rx, ry, 0.015, { shadow: false }));
      root.add(onWall(p, side, x, 0.4, 0.015));
    }
  }
  // two steam pipes along the port wall, with flanges and a valve wheel
  const pipe = paint('#a8693f', { rough: 0.45 });
  // two runs, broken round the engine's exhaust riser
  for (const [a, b] of [[x0 + 0.2, -10.45], [-9.55, x1 - 0.15]]) {
    for (const y of [2.22, 2.42]) {
      root.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, b - a, 12).rotateZ(Math.PI / 2), pipe, (a + b) / 2, y, -WALL + 0.14));
      for (const end of [a, b]) root.add(mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 12).rotateZ(Math.PI / 2), paint(IRON), end, y, -WALL + 0.14));
    }
    // brackets down to the wall
    for (let x = a + 0.6; x < b - 0.3; x += 1.6) root.add(mesh(new THREE.BoxGeometry(0.05, 0.36, 0.18), paint(IRON), x, 2.32, -WALL + 0.09));
  }
  const wheel = new THREE.Group();
  wheel.add(mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 20), paint('#e2574c', { rough: 0.5 })));
  for (let i = 0; i < 3; i++) {
    const spoke = mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), paint('#e2574c'));
    spoke.rotation.z = (i / 3) * Math.PI;
    wheel.add(spoke);
  }
  wheel.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8).rotateX(Math.PI / 2), paint(IRON), 0, 0, -0.1));
  wheel.position.set(-6.9, 2.32, -WALL + 0.38);
  root.add(wheel);
  // a cluster of pressure gauges, needles twitching
  const gauges = [];
  for (const [dx, dy, r] of [[0, 0, 0.16], [0.4, 0.08, 0.12], [0.36, -0.26, 0.1]]) {
    const gg = gauge(r);
    root.add(onWall(gg, 'port', -6.1 + dx, 1.62 + dy, 0.02));
    gauges.push(gg.userData.needle);
    live.add(gg.userData.needle);
  }
  // hazard stripes round the engine block
  const stripes = [];
  const stripe = (cx, cz, w, d) => stripes.push({ cx, cz, w, d });
  stripe(-10, -0.62, 2.6, 0.12);
  stripe(-11.35, -1.8, 0.12, 2.3);
  stripe(-8.65, -1.8, 0.12, 2.3);
  for (const s of stripes) {
    const count = Math.round(Math.max(s.w, s.d) / 0.18);
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * (Math.max(s.w, s.d) / count);
      const x = s.w > s.d ? s.cx + along : s.cx;
      const z = s.w > s.d ? s.cz : s.cz + along;
      const tile = mesh(new THREE.BoxGeometry(s.w > s.d ? 0.17 : s.w, 0.008, s.w > s.d ? s.d : 0.17), paint(i % 2 ? '#22263a' : '#ffc93c', { rough: 0.7 }), x, 0.065, z, { shadow: false });
      root.add(tile);
    }
  }
  // coal sacks in the corner by the bulkhead
  const sack = paint('#8b6b45', { rough: 1, flat: true });
  for (const [x, z, s] of [[-5.75, -2.5, 1], [-5.95, -2.05, 0.85], [-5.7, -2.25, 0.8]]) {
    const bag = mesh(new THREE.IcosahedronGeometry(0.28 * s, 1), sack, x, 0.24 * s + (s < 0.85 ? 0.32 : 0), z);
    bag.scale.set(1, 0.85, 0.8);
    root.add(bag);
  }
  colliders.push(new THREE.Box3(new THREE.Vector3(-6.3, 0, -2.9), new THREE.Vector3(-5.35, 0.9, -1.75)));
  // the safety board
  const sign = board(1.1, 0.55, (g, w, h) => {
    text(g, 'DAYS WITHOUT', w / 2, h * 0.2, 54, '#fff4dc');
    text(g, 'A FIRE', w / 2, h * 0.42, 54, '#fff4dc');
    g.fillStyle = '#fff4dc';
    g.fillRect(w * 0.36, h * 0.56, w * 0.28, h * 0.36);
    text(g, '0', w / 2, h * 0.75, 110, '#e2574c');
  });
  root.add(onWall(sign, 'starboard', -13.1, 2.05, 0.03));
  return gauges;
}

// --- the power room ----------------------------------------------------------------

function powerRoom(root, live) {
  // a cable tray along the ceiling, starboard side, red / green / blue cables
  const tray = new THREE.Group();
  const len = 2 * INNER - 0.4;
  const steel = paint('#9aa3b5', { rough: 0.5 });
  tray.add(mesh(new THREE.BoxGeometry(len, 0.02, 0.26), steel, 0, 0, 0));
  for (const dz of [-0.13, 0.13]) tray.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.02), steel, 0, 0.03, dz));
  ['#e2574c', '#49b97a', '#4a86e8'].forEach((c, i) => tray.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8).rotateZ(Math.PI / 2), paint(c, { rough: 0.6 }), 0, 0.04, -0.07 + i * 0.07)));
  for (let x = -len / 2 + 0.4; x < len / 2; x += 1.6) tray.add(mesh(new THREE.BoxGeometry(0.025, 0.22, 0.025), steel, x, 0.12, -0.11));
  tray.position.set(0, 2.72, 1.6);
  root.add(tray);
  // a ceiling fan
  const fan = new THREE.Group();
  fan.position.set(-2.6, 2.86, -0.9);
  fan.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), paint(IRON), 0, 0.05, 0));
  fan.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.1, 14), paint(BRASS, { rough: 0.35 }), 0, -0.08, 0));
  const blades = new THREE.Group();
  blades.position.y = -0.12;
  for (let i = 0; i < 4; i++) {
    const blade = mesh(new RoundedBoxGeometry(0.55, 0.02, 0.15, 2, 0.008), paint('#8a5634'), 0.33, 0, 0);
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    blade.rotation.x = 0.18;
    arm.add(blade);
    blades.add(arm);
  }
  fan.add(blades);
  root.add(fan);
  live.add(blades);
  // a panel of blinking indicator lights on the port wall
  const panel = new THREE.Group();
  panel.add(mesh(new RoundedBoxGeometry(0.78, 0.62, 0.08, 2, 0.02), paint('#3a4152'), 0, 0, 0.04));
  const lights = [];
  const colors = ['#ff5a5f', '#ffc93c', '#5fd068', '#3bb7ff'];
  const rand = seeded(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const color = colors[(r + c) % colors.length];
      const bulb = mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 }), -0.255 + c * 0.17, 0.17 - r * 0.17, 0.09, { shadow: false });
      bulb.userData.blink = { speed: 0.6 + rand() * 2.2, phase: rand() * 6.28 };
      panel.add(bulb);
      lights.push(bulb);
    }
  }
  panel.add(mesh(new THREE.BoxGeometry(0.62, 0.07, 0.02), paint('#1c2030'), 0, -0.25, 0.085, { shadow: false }));
  root.add(onWall(panel, 'port', 1.2, 1.75, 0.02)); // beside the cargo door, clear of the valve
  lights.forEach((l) => live.add(l));
  // the engineer's chalkboard, on the bulkhead by the fuse box
  const chalk = board(1.15, 0.75, (g, w, h) => {
    g.strokeStyle = '#e8f0e0';
    g.lineWidth = 5;
    text(g, 'POWER = 6', w / 2, h * 0.14, 44, '#ffe9a8');
    const tubes = ['ENG', 'SHLD', 'LIFT'];
    tubes.forEach((t, i) => {
      const x = w * (0.22 + i * 0.28);
      g.strokeRect(x - 34, h * 0.32, 68, h * 0.42);
      text(g, t, x, h * 0.85, 30, '#e8f0e0');
      g.fillStyle = ['#ff9a8f', '#9fd8ff', '#b6f0a8'][i];
      g.fillRect(x - 26, h * 0.32 + h * 0.42 - (i + 1) * 22, 52, (i + 1) * 22 - 6);
    });
    g.beginPath();
    g.moveTo(w * 0.08, h * 0.95);
    g.lineTo(w * 0.92, h * 0.95);
    g.stroke();
  }, { bg: '#2b3a32' });
  root.add(onWall(chalk, { x: INNER, facing: -1 }, -1.85, 1.65, 0.03));
  // a poster on the other bulkhead
  const poster = board(0.6, 0.8, (g, w, h) => {
    g.fillStyle = '#ffc93c';
    g.fillRect(0, 0, w, h);
    text(g, 'VENT', w / 2, h * 0.22, 96, '#22263a');
    text(g, 'WHEN', w / 2, h * 0.42, 96, '#22263a');
    text(g, 'HOT!', w / 2, h * 0.62, 96, '#e2574c');
    g.fillStyle = '#22263a';
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.72);
    g.lineTo(w * 0.36, h * 0.92);
    g.lineTo(w * 0.64, h * 0.92);
    g.closePath();
    g.fill();
  }, { bg: '#ffc93c', frame: '#3b2516' });
  root.add(onWall(poster, { x: -INNER, facing: 1 }, 1.7, 1.6, 0.03));
  return { blades, lights };
}

// --- the helm ---------------------------------------------------------------------

function porthole() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.33, 0.06, 10, 28), paint(BRASS, { rough: 0.3 }), 0, 0, 0.05));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(new THREE.SphereGeometry(0.022, 6, 4), paint('#8a6a2a'), Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0.1, { shadow: false }));
  }
  const glass = mesh(new THREE.CircleGeometry(0.3, 28), new THREE.MeshStandardMaterial({ color: '#bfe0ff', emissive: '#bfe0ff', emissiveIntensity: 0.8, roughness: 0.15 }), 0, 0, 0.03, { shadow: false });
  g.add(glass);
  g.userData.glass = glass;
  return g;
}

function helm(root, live, colliders) {
  // portholes on both side walls, showing the weather outside
  const glasses = [];
  for (const [side, x] of [['port', 12.6], ['port', 9.2], ['starboard', 12.9]]) {
    const p = porthole();
    root.add(onWall(p, side, x, 1.75, 0.0));
    glasses.push(p.userData.glass);
  }
  // a bookshelf of logbooks on the starboard wall
  const shelf = new THREE.Group();
  const rand = seeded(17);
  const covers = ['#b0413e', '#2f5d8a', '#3f7d4f', '#8a5a2b', '#5b3f7a', '#c48a2a'];
  for (const y of [0, 0.42]) {
    shelf.add(mesh(new THREE.BoxGeometry(1.3, 0.04, 0.26), paint('#7a4f31'), 0, y, 0.13));
    let x = -0.6;
    while (x < 0.58) {
      const thick = 0.05 + rand() * 0.05;
      const tall = 0.22 + rand() * 0.1;
      const book = mesh(new THREE.BoxGeometry(thick, tall, 0.2), paint(covers[Math.floor(rand() * covers.length)]), x + thick / 2, y + 0.02 + tall / 2, 0.13);
      if (rand() < 0.12) book.rotation.z = 0.25;
      shelf.add(book);
      x += thick + 0.008;
    }
  }
  root.add(onWall(shelf, 'starboard', 6.9, 1.25, 0.0));
  // a round rug where the crew comes in
  const rug = new THREE.Group();
  rug.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.012, 40), paint('#2f5d8a', { rough: 1 }), 0, 0, 0, { shadow: false }));
  rug.add(mesh(new THREE.RingGeometry(0.72, 0.84, 40).rotateX(-Math.PI / 2), paint('#ffc93c', { rough: 1 }), 0, 0.008, 0, { shadow: false }));
  rug.add(mesh(new THREE.RingGeometry(0.2, 0.28, 30).rotateX(-Math.PI / 2), paint('#ffc93c', { rough: 1 }), 0, 0.008, 0, { shadow: false }));
  rug.position.set(6.9, 0.07, 0);
  root.add(rug);
  // a globe on a stand in the bow corner
  const globe = new THREE.Group();
  globe.position.set(13.75, 0, -2.45);
  globe.add(mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.08, 14), paint('#5b3a22'), 0, 0.04, 0));
  globe.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), paint('#5b3a22'), 0, 0.42, 0));
  const ball = new THREE.Group();
  ball.position.y = 1.0;
  ball.rotation.z = 0.4;
  const sea = mesh(new THREE.SphereGeometry(0.24, 20, 14), paint('#3f8fe0', { rough: 0.5 }));
  ball.add(sea);
  for (let i = 0; i < 6; i++) {
    const land = mesh(new THREE.IcosahedronGeometry(0.09, 0), paint('#7cc95a', { flat: true }));
    const a = rand() * Math.PI * 2;
    const e = (rand() - 0.5) * 2;
    land.position.set(Math.cos(a) * 0.2 * Math.cos(e * 0.6), Math.sin(e * 0.6) * 0.2, Math.sin(a) * 0.2 * Math.cos(e * 0.6));
    land.scale.set(1, 0.4, 1);
    land.lookAt(0, 0, 0);
    ball.add(land);
  }
  ball.add(mesh(new THREE.TorusGeometry(0.28, 0.012, 6, 30, Math.PI * 1.2), paint(BRASS, { rough: 0.3 })));
  globe.add(ball);
  root.add(globe);
  live.add(ball);
  colliders.push(new THREE.Box3(new THREE.Vector3(13.4, 0, -2.85), new THREE.Vector3(14.1, 1.3, -2.05)));
  // the captain's hat on a peg by the door
  const peg = new THREE.Group();
  peg.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6).rotateX(Math.PI / 2), paint('#5b3a22'), 0, 0, 0.09));
  const hat = new THREE.Group();
  hat.position.set(0, -0.05, 0.16);
  hat.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 20), paint('#22263a'), 0, 0, 0));
  hat.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.12, 20), paint('#22263a'), 0, 0.07, 0));
  hat.add(mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.025, 20), paint(BRASS, { rough: 0.3 }), 0, 0.03, 0));
  hat.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), paint('#ffffff'), 0, 0.08, 0.14));
  hat.rotation.x = -0.35;
  peg.add(hat);
  root.add(onWall(peg, 'port', 5.5, 1.85, 0.0));
  // a brass lantern hanging from the ceiling, swinging with the ship
  const lantern = new THREE.Group();
  lantern.position.set(9.6, 2.98, 0);
  lantern.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), paint(IRON), 0, -0.25, 0, { shadow: false }));
  const body = new THREE.Group();
  body.position.y = -0.5;
  body.add(mesh(new THREE.ConeGeometry(0.13, 0.1, 8), paint(BRASS, { rough: 0.3 }), 0, -0.02, 0));
  body.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8), new THREE.MeshStandardMaterial({ color: '#ffe8a8', emissive: '#ffbf5a', emissiveIntensity: 1.3 }), 0, -0.18, 0, { shadow: false }));
  body.add(mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.04, 8), paint(BRASS, { rough: 0.3 }), 0, -0.31, 0));
  lantern.add(body);
  const glow = new THREE.PointLight('#ffc070', 1.4, 5, 2);
  glow.position.y = -0.68;
  lantern.add(glow);
  root.add(lantern);
  live.add(lantern);
  return { glasses, lantern, ball };
}

// --- putting it together ------------------------------------------------------------

export function dressCabin(world) {
  const root = new THREE.Group();
  root.name = 'cabinDetails';
  const live = new Set();
  const colliders = [];
  ribs(root);
  const gauges = engineRoom(root, live, colliders);
  const power = powerRoom(root, live);
  const helmParts = helm(root, live, colliders);
  world.ship.add(root);
  // the still parts merge into a few meshes; the moving ones stay apart
  const keep = new Set(live);
  for (const o of live) o.traverse((c) => keep.add(c));
  bake(root, keep);
  // the floor pieces get a box, like the rooms' own furniture
  for (const list of [world.lobbyColliders, world.lobbyGatedColliders, world.flightColliders]) {
    if (list && list !== world.colliders) list.push(...colliders);
  }
  world.colliders.push(...colliders);
  world.cabin = { gauges, ...power, ...helmParts };
  return world.cabin;
}

const STORM_GLASS = new THREE.Color('#2d3157');
const FAIR_GLASS = new THREE.Color('#bfe0ff');

// Every frame: needles twitch, the fan turns, lights blink, the lantern
// swings, and the portholes show the weather (fair: 1 sunny .. 0 storm).
export function updateCabin(world, { t, dt, fair, power = 2 }) {
  const c = world.cabin;
  if (!c) return;
  c.gauges.forEach((needle, i) => {
    needle.rotation.z = -0.9 + power * 0.25 + Math.sin(t * (7 + i * 3)) * 0.05 + Math.sin(t * 1.3 + i) * 0.15;
  });
  c.blades.rotation.y += dt * 9;
  for (const bulb of c.lights) {
    const b = bulb.userData.blink;
    bulb.material.emissiveIntensity = Math.sin(t * b.speed * 3 + b.phase) > 0.2 ? 1.6 : 0.15;
  }
  c.lantern.rotation.z = Math.sin(t * 1.1) * 0.08;
  c.lantern.rotation.x = Math.sin(t * 0.8 + 1) * 0.05;
  c.ball.rotation.y += dt * 0.15;
  for (const glass of c.glasses) {
    glass.material.color.copy(STORM_GLASS).lerp(FAIR_GLASS, fair);
    glass.material.emissive.copy(glass.material.color);
  }
}
