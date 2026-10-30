// The airship's envelope: the big gas bag that keeps her up. A proper
// zeppelin shape (round nose, tapering tail), orange and gold fabric
// panels with seams, stitched patches (she lives up to her name), the
// name painted down both sides, brass hoops and a nose cap, four tail fins
// with a flag, two engine pods and a tail propeller that turn faster in
// flight, rigging down to the hull, and red and green navigation lights.
//
// Scenery only: it hangs above the cabin roof, nothing to walk into or aim
// at.

import * as THREE from 'three';
import { SHIP } from './world.js';
import { mesh, paint, stretch } from './harbour.js';

// Half as long again as the hull (45 m over 30) and fat with it, so she
// reads as a real airship, a big bag over a small cabin, and grows with
// the hull. Its belly hangs 1.6 m clear of the roof (3.2 m) for the rigging.
export const ENVELOPE = { length: SHIP.length * 1.5, radius: 7.8, y: 12.6 };
const HALF = ENVELOPE.length / 2;
// The fins, engines and propellers were drawn for a 6.1 m bag: they grow
// in step, so they keep their proportions.
const S = ENVELOPE.radius / 6.1;

// Radius along the length, u from -1 (tail) to 1 (nose).
function radiusAt(u) {
  const k = 1 - u * u;
  return ENVELOPE.radius * Math.pow(Math.max(0, k), u > 0 ? 0.4 : 0.62);
}

// The fabric: panels round the bag (u: around, v: along, tail to nose),
// seams, stitched patches, and the name down both sides.
function fabric() {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  paintFabric(canvas.getContext('2d'), W, H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // The name is in the game's own font, which is seldom loaded yet on a
  // cold start: paint it all again once it is, rather than keep the fallback.
  document.fonts
    ?.load('900 150px "Lilita One"')
    .then(() => {
      paintFabric(canvas.getContext('2d'), W, H);
      texture.needsUpdate = true;
    })
    .catch(() => {});
  return texture;
}

function paintFabric(g, W, H) {
  const gores = 16;
  for (let i = 0; i < gores; i++) {
    g.fillStyle = i % 2 ? '#ec7a34' : '#f39a3c';
    g.fillRect((i * W) / gores, 0, W / gores + 1, H);
    // a little shading across each panel, so they read as puffed out
    const grad = g.createLinearGradient((i * W) / gores, 0, ((i + 1) * W) / gores, 0);
    grad.addColorStop(0, 'rgba(120, 40, 10, 0.18)');
    grad.addColorStop(0.5, 'rgba(255, 230, 190, 0.08)');
    grad.addColorStop(1, 'rgba(120, 40, 10, 0.18)');
    g.fillStyle = grad;
    g.fillRect((i * W) / gores, 0, W / gores + 1, H);
    // the seam
    g.fillStyle = 'rgba(110, 45, 15, 0.55)';
    g.fillRect((i * W) / gores - 2, 0, 4, H);
  }
  // bands round the bag (lines along u at a few v)
  for (const v of [0.18, 0.5, 0.82]) {
    g.fillStyle = 'rgba(90, 40, 15, 0.35)';
    g.fillRect(0, H * (1 - v) - 3, W, 6);
  }
  // Stitched patches: she lives up to her name, so they are the loudest
  // thing on her. Odd scraps of whatever cloth was to hand (denim, tartan,
  // ticking, canvas, polka dots), big, raised a little off the bag, with
  // cream thread. The canvas is stretched about 1.8 times more round the
  // bag than along it, so a patch is drawn wide to come out squarish.
  // Clear of the name bands (u 0.21 to 0.29 and 0.71 to 0.79).
  const cloth = {
    denim: (w, h) => {
      g.fillStyle = '#4a6fa5';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      g.lineWidth = 2;
      for (let x = -w; x < w; x += 7) {
        g.beginPath();
        g.moveTo(x, -h / 2);
        g.lineTo(x + h, h / 2);
        g.stroke();
      }
    },
    tartan: (w, h) => {
      g.fillStyle = '#b8423a';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = 'rgba(40, 20, 30, 0.35)';
      for (let x = -w / 2; x < w / 2; x += 34) g.fillRect(x, -h / 2, 12, h);
      for (let y = -h / 2; y < h / 2; y += 20) g.fillRect(-w / 2, y, w, 7);
      g.fillStyle = 'rgba(255, 210, 90, 0.6)';
      for (let x = -w / 2 + 22; x < w / 2; x += 34) g.fillRect(x, -h / 2, 2, h);
    },
    ticking: (w, h) => {
      g.fillStyle = '#f1e4c4';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#5f8a52';
      for (let y = -h / 2 + 4; y < h / 2; y += 14) g.fillRect(-w / 2, y, w, 5);
    },
    canvas: (w, h) => {
      g.fillStyle = '#d8b27a';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.strokeStyle = 'rgba(90, 55, 20, 0.18)';
      g.lineWidth = 1;
      for (let x = -w / 2; x < w / 2; x += 4) {
        g.beginPath();
        g.moveTo(x, -h / 2);
        g.lineTo(x, h / 2);
        g.stroke();
      }
    },
    dots: (w, h) => {
      g.fillStyle = '#e9c13f';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#7a3b16';
      for (let y = -h / 2 + 8; y < h / 2; y += 16) {
        for (let x = -w / 2 + ((y / 16) % 2 ? 10 : 20); x < w / 2; x += 20) {
          g.beginPath();
          g.arc(x, y, 3.5, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  };
  const patch = (u, v, w, h, kind, tilt) => {
    g.save();
    g.translate(u * W, (1 - v) * H);
    g.rotate(tilt);
    // a soft shadow under it, so it sits on the bag rather than in it
    g.fillStyle = 'rgba(70, 25, 5, 0.35)';
    g.fillRect(-w / 2 + 4, -h / 2 + 5, w, h);
    g.beginPath();
    g.rect(-w / 2, -h / 2, w, h);
    g.clip();
    cloth[kind](w, h);
    g.strokeStyle = 'rgba(50, 25, 10, 0.7)';
    g.lineWidth = 3;
    g.strokeRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3);
    g.strokeStyle = '#fff3d6';
    g.lineWidth = 4;
    g.setLineDash([11, 8]);
    g.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20);
    g.setLineDash([]);
    g.restore();
  };
  patch(0.62, 0.32, 150, 84, 'tartan', 0.12); // port flank, low: seen from the dock
  patch(0.66, 0.72, 128, 70, 'denim', -0.18);
  patch(0.86, 0.46, 140, 76, 'dots', 0.22); // port flank, high
  patch(0.95, 0.82, 110, 64, 'ticking', -0.1);
  patch(0.53, 0.55, 120, 66, 'canvas', 0.3); // under the belly
  patch(0.38, 0.62, 150, 84, 'denim', 0.15); // starboard flank
  patch(0.35, 0.4, 120, 68, 'ticking', -0.2); // forward of the engine pod (v 0.18)
  patch(0.13, 0.4, 140, 78, 'tartan', -0.12);
  patch(0.07, 0.78, 110, 62, 'canvas', 0.25);
  // the name, down both sides (starboard at u 0.25, port at u 0.75)
  const name = (u, angle) => {
    g.save();
    g.translate(u * W, H * 0.5);
    g.rotate(angle);
    g.font = '900 150px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 16;
    g.strokeStyle = '#5a2a10';
    // It runs along the canvas height: squeezed to fit, stroke and all,
    // whichever font it is drawn in.
    const fit = H - 80;
    g.strokeText('PATCH IT UP!', 0, 0, fit);
    g.fillStyle = '#fff1c9';
    g.fillText('PATCH IT UP!', 0, 0, fit);
    g.restore();
  };
  name(0.25, -Math.PI / 2);
  name(0.75, Math.PI / 2);
}

function envelope() {
  const points = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const u = -1 + (2 * i) / steps;
    points.push(new THREE.Vector2(Math.max(0.001, radiusAt(u)), u * HALF));
  }
  // starboard at u = 0.25 of the way round, port at 0.75, top at 0 / 1
  const geo = new THREE.LatheGeometry(points, 64, -Math.PI / 2, Math.PI * 2);
  geo.rotateZ(-Math.PI / 2); // the lathe's axis becomes the ship's length
  const material = new THREE.MeshStandardMaterial({ map: fabric(), roughness: 0.62, metalness: 0, side: THREE.FrontSide });
  return mesh(geo, material);
}

// rootAt(x): how far below the fin's base line the bag's surface is at x
// along the root (0 at the trailing edge, 4.2 at the leading), 0 or less.
// The bag tapers fast under the tail, so the root follows it down rather
// than leaving the back of the fin hanging in the air.
const FIN_ROOT = 4.2 * S;
function fin(rand = 0, rootAt = () => 0) {
  const top = (3.4 + rand) * S;
  const shape = new THREE.Shape();
  shape.moveTo(0, rootAt(0));
  for (let i = 1; i <= 8; i++) {
    const x = (FIN_ROOT * i) / 8;
    shape.lineTo(x, rootAt(x));
  }
  shape.lineTo(1.2 * S, top);
  shape.lineTo(-0.4 * S, top);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 });
  geo.translate(0, 0, -0.07);
  const g = new THREE.Group();
  g.add(mesh(geo, paint('#d6453b', { rough: 0.5 })));
  // gold trim along the trailing edge, from the root down on the bag to the tip
  const low = rootAt(0);
  const trim = mesh(new THREE.BoxGeometry(0.2, top - low + 0.1, 0.24), paint('#ffc93c', { rough: 0.4 }), -0.2 * S, (top + low) / 2, 0);
  trim.rotation.z = Math.atan2(0.4 * S, top - low); // leaning back with the edge
  g.add(trim);
  return g;
}

function propeller(radius, blades = 3) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.ConeGeometry(radius * 0.22, radius * 0.45, 12).rotateZ(-Math.PI / 2), paint('#d9a441', { rough: 0.3 }), radius * 0.2, 0, 0));
  const spin = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const arm = new THREE.Group();
    arm.rotation.x = (i / blades) * Math.PI * 2;
    const blade = mesh(new THREE.BoxGeometry(0.05, radius, radius * 0.24), paint('#6e4529', { rough: 0.6 }), 0, radius / 2, 0);
    blade.rotation.y = 0.35;
    arm.add(blade);
    spin.add(arm);
  }
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

function enginePod(side) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.75, 2.6, 6, 16).rotateZ(Math.PI / 2), paint('#7a8296', { rough: 0.4 }));
  g.add(body);
  for (const x of [-0.9, 0.9]) g.add(mesh(new THREE.TorusGeometry(0.77, 0.06, 8, 24).rotateY(Math.PI / 2), paint('#d9a441', { rough: 0.3 }), x, 0, 0));
  // struts up to the envelope
  for (const x of [-0.8, 0.8]) {
    const strut = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), paint('#4d5566', { rough: 0.5 }), x, 0.9, -side * 0.9);
    strut.rotation.x = -side * 0.75; // its top leans in, to meet the bag
    g.add(strut);
  }
  const prop = propeller(1.15, 3);
  prop.position.x = -2.05;
  prop.rotation.y = Math.PI; // pushes from behind
  g.add(prop);
  g.userData.prop = prop.userData.spin;
  return g;
}

export function buildAirship(world) {
  const ship = world.ship;
  const root = new THREE.Group();
  root.name = 'airship';
  root.position.y = ENVELOPE.y;

  root.add(envelope());

  // Brass hoops round the bag (the aft one forward of the engine pods, which
  // reach up to u -0.53). Each is two straps, over the top and under the
  // belly, stopping short of the name down each side with a rivet, so no
  // hoop ever crosses a letter. On the torus, angle 0 is port, PI/2 the top.
  const brass = paint('#d9a441', { rough: 0.3 });
  const NAME_GAP = 0.36; // radians either side of each flank: the lettering and a margin
  for (const u of [-0.45, 0, 0.45]) {
    const r = radiusAt(u) + 0.04;
    for (const start of [NAME_GAP, Math.PI + NAME_GAP]) {
      const strap = new THREE.TorusGeometry(r, 0.11, 8, 48, Math.PI - 2 * NAME_GAP).rotateZ(start).rotateY(Math.PI / 2);
      root.add(mesh(strap, brass, u * HALF, 0, 0));
      for (const a of [start, start + Math.PI - 2 * NAME_GAP]) {
        root.add(mesh(new THREE.SphereGeometry(0.2, 12, 8), brass, u * HALF, r * Math.sin(a), -r * Math.cos(a)));
      }
    }
  }
  root.add(mesh(new THREE.SphereGeometry(0.75 * S, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2), brass, HALF - 0.55 * S, 0, 0));
  root.add(mesh(new THREE.ConeGeometry(0.22 * S, 0.7 * S, 12).rotateZ(-Math.PI / 2), brass, HALF + 0.25 * S, 0, 0));

  // tail fins: top, bottom, port, starboard
  const finX = -HALF + 4.6 * S;
  const finBase = radiusAt((finX - S) / HALF) - 0.6;
  // Sunk 0.4 m into the bag all along the root, never higher than the base.
  const finRoot = (x) => Math.min(0, radiusAt((finX - 3.8 * S + x) / HALF) - 0.4 - finBase);
  for (const [angle, extra] of [[0, 0.6], [Math.PI, -0.4], [Math.PI / 2, 0], [-Math.PI / 2, 0]]) {
    const f = fin(extra, finRoot);
    const holder = new THREE.Group();
    holder.position.x = finX;
    holder.rotation.x = angle;
    f.position.set(-3.8 * S, finBase, 0);
    holder.add(f);
    root.add(holder);
  }
  // a flag on the top fin
  const flagY = radiusAt((finX - S) / HALF) + 3.8 * S;
  const flag = mesh(new THREE.PlaneGeometry(1.6 * S, 0.9 * S, 10, 3).translate(0.8 * S, 0, 0), paint('#ffc93c', { side: THREE.DoubleSide, rough: 0.9 }), finX - 4.1 * S, flagY, 0);
  flag.rotation.y = Math.PI;
  flag.userData.rest = Float32Array.from(flag.geometry.attributes.position.array);
  root.add(flag);
  root.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4 * S, 6), paint('#3e4a5c'), finX - 4.1 * S, flagY - 0.4 * S, 0));

  // the tail propeller
  const tail = propeller(1.5 * S, 4);
  tail.position.x = -HALF - 0.3 * S;
  tail.rotation.y = Math.PI;
  root.add(tail);

  // engine pods on struts, either side, towards the tail
  const pods = [];
  for (const side of [-1, 1]) {
    const pod = enginePod(side);
    pod.scale.setScalar(S);
    const x = -HALF * 0.64;
    const r = radiusAt(x / HALF);
    pod.position.set(x, -r * 0.45, side * (r + 0.55 * S));
    root.add(pod);
    pods.push(pod.userData.prop);
  }

  // navigation lights on the cabin's bow corners, where a ship carries
  // them: red to port, green to starboard, each in a brass cup on a bracket
  const navs = [];
  const navY = SHIP.wallHeight - 0.15 - ENVELOPE.y; // ship space 2.85 m, under the roof rail
  const navX = SHIP.length / 2 + 0.25;
  for (const [side, color] of [[-1, '#ff3b3b'], [1, '#3bff7a']]) {
    const z = side * (SHIP.width / 2 + 0.3);
    root.add(mesh(new THREE.BoxGeometry(0.36, 0.06, 0.06), paint('#4d5566'), navX - 0.15, navY - 0.2, z - side * 0.12));
    root.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 14), brass, navX, navY - 0.22, z));
    const light = mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }), navX, navY, z, { shadow: false });
    root.add(light);
    navs.push(light);
  }

  // rigging: ropes from the bag's belly down to the edges of the cabin roof,
  // every one the same unit cylinder stretched to fit
  const rope = paint('#e8d6ae', { rough: 0.9 });
  const ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
  const roofY = SHIP.wallHeight + 0.2 - ENVELOPE.y;
  for (let x = -SHIP.length / 2 + 1.5; x <= SHIP.length / 2 - 1.5; x += 3) {
    const r = radiusAt(x / HALF);
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(x, -r * 0.82, side * r * 0.55);
      const to = new THREE.Vector3(x, roofY, side * (SHIP.width / 2 - 0.15));
      root.add(stretch(mesh(ropeGeo, rope), from, to));
    }
  }
  // and two stout struts amidships, fore and aft, to carry the weight
  const strutGeo = new THREE.CylinderGeometry(0.16, 0.2, 1, 10);
  for (const x of [-HALF / 2, HALF / 2]) {
    const r = radiusAt(x / HALF);
    const foot = new THREE.Vector3(x, roofY, 0);
    const head = new THREE.Vector3(x, -r * 0.95, 0);
    root.add(stretch(mesh(strutGeo, paint('#6e4529')), foot, head)); // the thick end on the roof
  }

  ship.add(root);
  world.airship = { root, tail: tail.userData.spin, pods, flag, navs, wave: 0 };
  return world.airship;
}

// Every frame: propellers turn (slowly at the dock, hard in flight with
// the engines' power), the flag flies, the nav lights blink.
export function updateAirship(world, { t, dt, flying, engines = 2 }) {
  const a = world.airship;
  if (!a) return;
  const speed = flying ? 8 + engines * 5 : 1.6;
  a.tail.rotation.x += speed * dt;
  for (const p of a.pods) p.rotation.x -= speed * 1.2 * dt;
  // The wave runs on its own clock, faster in flight: a rate times the
  // whole clock would leap to an unrelated shape whenever the rate changed.
  a.wave += (flying ? 11 : 5) * dt;
  const pos = a.flag.geometry.attributes.position;
  const rest = a.flag.userData.rest;
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3];
    pos.setZ(i, Math.sin(x * 3.5 - a.wave) * 0.14 * x);
  }
  pos.needsUpdate = true;
  a.flag.geometry.computeVertexNormals();
  const blink = Math.sin(t * 3) > 0.6 ? 2.4 : 0.6;
  for (const n of a.navs) n.material.emissiveIntensity = blink;
}
