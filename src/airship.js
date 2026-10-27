// The airship's envelope: the big gas bag that keeps her up. A proper
// zeppelin shape (round nose, tapering tail), orange and gold fabric
// panels with seams, stitched patches (she lives up to her name), the
// name painted down both sides, brass hoops and a nose cap, four tail fins
// with a flag, two engine pods and a tail propeller that turn faster in
// flight, rigging down to the hull, and red and green navigation lights.
//
// Scenery only: it hangs above the cabin roof, nothing to walk into or aim
// at. It takes the place of the old plain balloon in world.js.

import * as THREE from 'three';
import { SHIP } from './world.js';
import { mesh, paint } from './harbour.js';

export const ENVELOPE = { length: 36, radius: 6.1, y: 10.7 };
const HALF = ENVELOPE.length / 2;

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
  const g = canvas.getContext('2d');
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
  // stitched patches
  const patch = (u, v, w, h, color, tilt) => {
    g.save();
    g.translate(u * W, (1 - v) * H);
    g.rotate(tilt);
    g.fillStyle = color;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = '#4a2a12';
    g.lineWidth = 3;
    g.setLineDash([8, 7]);
    g.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14);
    g.setLineDash([]);
    g.restore();
  };
  patch(0.08, 0.66, 90, 60, '#c99a5b', 0.2);
  patch(0.31, 0.3, 70, 70, '#b98a4f', -0.15);
  patch(0.7, 0.72, 80, 55, '#c99a5b', -0.25);
  patch(0.94, 0.38, 64, 64, '#d6aa66', 0.3);
  patch(0.18, 0.86, 54, 44, '#b98a4f', 0.05);
  patch(0.62, 0.24, 60, 48, '#d6aa66', 0.12);
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
    g.strokeText('PATCH IT UP!', 0, 0);
    g.fillStyle = '#fff1c9';
    g.fillText('PATCH IT UP!', 0, 0);
    g.restore();
  };
  name(0.25, -Math.PI / 2);
  name(0.75, Math.PI / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
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

function fin(rand = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(4.2, 0);
  shape.lineTo(1.2, 3.4 + rand);
  shape.lineTo(-0.4, 3.4 + rand);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 });
  geo.translate(0, 0, -0.07);
  const g = new THREE.Group();
  g.add(mesh(geo, paint('#d6453b', { rough: 0.5 })));
  // gold trim along the trailing edge
  g.add(mesh(new THREE.BoxGeometry(0.2, 3.5 + rand, 0.24), paint('#ffc93c', { rough: 0.4 }), -0.3, (3.4 + rand) / 2, 0));
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
    strut.rotation.x = side * 0.75;
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
  ship.getObjectByName('balloon')?.removeFromParent();
  const root = new THREE.Group();
  root.name = 'airship';
  root.position.y = ENVELOPE.y;

  root.add(envelope());

  // brass hoops round the bag, and a cap on the nose
  for (const u of [-0.55, 0, 0.55]) {
    const r = radiusAt(u);
    root.add(mesh(new THREE.TorusGeometry(r + 0.04, 0.09, 8, 64).rotateY(Math.PI / 2), paint('#d9a441', { rough: 0.3 }), u * HALF, 0, 0));
  }
  root.add(mesh(new THREE.SphereGeometry(0.75, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2), paint('#d9a441', { rough: 0.3 }), HALF - 0.55, 0, 0));
  root.add(mesh(new THREE.ConeGeometry(0.22, 0.7, 12).rotateZ(-Math.PI / 2), paint('#d9a441', { rough: 0.3 }), HALF + 0.25, 0, 0));

  // tail fins: top, bottom, port, starboard
  const finX = -HALF + 4.6;
  for (const [angle, extra] of [[0, 0.6], [Math.PI, -0.4], [Math.PI / 2, 0], [-Math.PI / 2, 0]]) {
    const f = fin(extra);
    const holder = new THREE.Group();
    holder.position.x = finX;
    holder.rotation.x = angle;
    f.position.set(-3.8, radiusAt((finX - 1) / HALF) - 0.6, 0);
    holder.add(f);
    root.add(holder);
  }
  // a flag on the top fin
  const flag = mesh(new THREE.PlaneGeometry(1.6, 0.9, 10, 3).translate(0.8, 0, 0), paint('#ffc93c', { side: THREE.DoubleSide, rough: 0.9 }), finX - 4.1, radiusAt((finX - 1) / HALF) + 3.8, 0);
  flag.rotation.y = Math.PI;
  flag.userData.rest = Float32Array.from(flag.geometry.attributes.position.array);
  root.add(flag);
  root.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), paint('#3e4a5c'), finX - 4.1, radiusAt((finX - 1) / HALF) + 3.4, 0));

  // the tail propeller
  const tail = propeller(1.5, 4);
  tail.position.x = -HALF - 0.3;
  tail.rotation.y = Math.PI;
  root.add(tail);

  // engine pods on struts, either side, towards the tail
  const pods = [];
  for (const side of [-1, 1]) {
    const pod = enginePod(side);
    // aft, clear of the name painted amidships
    const r = radiusAt(-11.5 / HALF);
    pod.position.set(-11.5, -r * 0.45, side * (r + 0.55));
    root.add(pod);
    pods.push(pod.userData.prop);
  }

  // navigation lights: red to port, green to starboard
  const navs = [];
  for (const [side, color] of [[-1, '#ff3b3b'], [1, '#3bff7a']]) {
    const light = mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }), 4, -1.2, side * (radiusAt(4 / HALF) + 0.05), { shadow: false });
    root.add(light);
    navs.push(light);
  }

  // rigging: ropes from the bag's belly down to the edges of the cabin roof
  const rope = paint('#e8d6ae', { rough: 0.9 });
  const roofY = SHIP.wallHeight + 0.2 - ENVELOPE.y;
  for (let x = -SHIP.length / 2 + 1.5; x <= SHIP.length / 2 - 1.5; x += 3) {
    const r = radiusAt(x / HALF);
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(x, -r * 0.82, side * r * 0.55);
      const to = new THREE.Vector3(x + side * 0.0, roofY, side * (SHIP.width / 2 - 0.15));
      const length = from.distanceTo(to);
      const line = mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 5), rope);
      line.position.copy(from).add(to).multiplyScalar(0.5);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      root.add(line);
    }
  }
  // and two stout struts amidships, fore and aft, to carry the weight
  for (const x of [-9, 9]) {
    const r = radiusAt(x / HALF);
    const from = new THREE.Vector3(x, -r * 0.95, 0);
    const to = new THREE.Vector3(x, roofY, 0);
    const strut = mesh(new THREE.CylinderGeometry(0.16, 0.2, from.distanceTo(to), 10), paint('#6e4529'));
    strut.position.copy(from).add(to).multiplyScalar(0.5);
    root.add(strut);
  }

  ship.add(root);
  world.airship = { root, tail: tail.userData.spin, pods, flag, navs };
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
  const pos = a.flag.geometry.attributes.position;
  const rest = a.flag.userData.rest;
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3];
    pos.setZ(i, Math.sin(x * 3.5 - t * (flying ? 11 : 5)) * 0.14 * x);
  }
  pos.needsUpdate = true;
  a.flag.geometry.computeVertexNormals();
  const blink = Math.sin(t * 3) > 0.6 ? 2.4 : 0.6;
  for (const n of a.navs) n.material.emissiveIntensity = blink;
}
