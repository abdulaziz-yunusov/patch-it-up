// The player: a 0.4 m sphere with the camera at eye height inside it.
// You never see your own sphere, only the other players'.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export const PLAYER = {
  radius: 0.4,
  eyeHeight: 1.5,
  speed: 4, // metres per second
  jumpSpeed: 4.6,
  gravity: 14,
};

export const ROLE_COLORS = {
  mechanic: '#e2574c',
  engineer: '#49b97a',
  pilot: '#4a86e8',
  crew: '#d9d2c5', // before a role is picked
};

const ONE_SHOT = ['KeyE', 'Digit1', 'Digit2', 'Digit3'];

// A sphere with two eyes, so the others can tell which way you face.
export function createPlayerMesh(color = ROLE_COLORS.crew) {
  const body = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(PLAYER.radius, 20, 14),
    new THREE.MeshStandardMaterial({ color, flatShading: true })
  );
  body.userData.sphere = sphere; // so the role colour can change later
  body.add(sphere);

  const white = new THREE.MeshStandardMaterial({ color: '#fff4dc', flatShading: true });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), white);
    eye.position.set(side * 0.15, 0.1, -0.33); // -z is the way you look
    body.add(eye);
  }
  return body;
}

export function createBody(x = -10, z = 0) {
  return {
    position: new THREE.Vector3(x, PLAYER.radius, z),
    velocityY: 0,
    onGround: true,
    atWheel: false,
  };
}

// Where a player is looking, in ship space, from the yaw and pitch they sent.
export function lookDirection(yaw, pitch, out = new THREE.Vector3()) {
  const cosPitch = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
}

const _move = new THREE.Vector3();
const _candidate = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), PLAYER.radius);

// Move if nothing solid is in the way, otherwise stay put on that axis.
function tryMove(body, colliders, dx, dy, dz) {
  _candidate.set(body.position.x + dx, body.position.y + dy, body.position.z + dz);
  _sphere.center.copy(_candidate);
  if (colliders.some((box) => box.intersectsSphere(_sphere))) {
    if (dy !== 0) {
      if (body.velocityY < 0) body.onGround = true; // landed on something solid
      body.velocityY = 0;
    }
    return false;
  }
  body.position.copy(_candidate);
  return true;
}

// One step of movement. The host runs this for all three players; every
// browser also runs it for itself, so walking feels instant.
export function stepBody(body, input, colliders, dt) {
  const keys = input.keys ?? {};
  const yaw = input.yaw ?? 0;

  // At the wheel your feet stay planted: A and D steer instead (game.js).
  _move.set(0, 0, 0);
  if (!body.atWheel) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    if (keys.KeyW) _move.set(_move.x - sin, 0, _move.z - cos);
    if (keys.KeyS) _move.set(_move.x + sin, 0, _move.z + cos);
    if (keys.KeyD) _move.set(_move.x + cos, 0, _move.z - sin);
    if (keys.KeyA) _move.set(_move.x - cos, 0, _move.z + sin);
  }
  if (_move.lengthSq() > 0) {
    _move.normalize().multiplyScalar(PLAYER.speed * dt);
    // X and Z separately, so a wall you graze lets you slide along it.
    tryMove(body, colliders, _move.x, 0, 0);
    tryMove(body, colliders, 0, 0, _move.z);
  }

  if (keys.Space && body.onGround && !body.atWheel) {
    body.velocityY = PLAYER.jumpSpeed;
    body.onGround = false;
  }
  body.velocityY -= PLAYER.gravity * dt;
  body.onGround = false;
  tryMove(body, colliders, 0, body.velocityY * dt, 0);

  // The deck itself is not a collider: a sphere resting on it would
  // overlap and block every step. It is a floor height instead.
  if (body.position.y < PLAYER.radius) {
    body.position.y = PLAYER.radius;
    body.velocityY = 0;
    body.onGround = true;
  }
}

// Everything lives in the ship's local space, so when the ship rocks the
// player rocks with it: the mesh and the camera are children of the ship.
export class LocalPlayer {
  constructor({ ship, camera, colliders }) {
    this.ship = ship;
    this.camera = camera;
    this.colliders = colliders;
    this.body = createBody();
    this.keys = {};
    this.taps = new Set(); // keys pressed since the last input was read
    this.dropRequested = false;

    this.controls = new PointerLockControls(camera, document.body);
    this.controls.addEventListener('unlock', () => {
      this.keys = {};
      this.taps.clear();
    });

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!e.repeat && ONE_SHOT.includes(e.code)) this.taps.add(e.code);
      if (e.code === 'Space' && this.controls.isLocked) e.preventDefault();
    });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    addEventListener('mousedown', (e) => {
      if (e.button === 2 && this.controls.isLocked) this.dropRequested = true;
    });
  }

  // Step aboard at a spot in ship space, camera parented to the ship.
  enter(x, z, yaw = -Math.PI / 2) {
    this.body.position.set(x, PLAYER.radius, z);
    this.body.velocityY = 0;
    this.body.onGround = true;
    this.body.atWheel = false;
    this.keys = {};
    this.taps.clear();
    this.ship.add(this.camera);
    this.camera.rotation.set(0, yaw, 0);
    this.syncView();
  }

  // Back to the menu: the camera leaves the ship and orbits again.
  exit(scene) {
    this.keys = {};
    this.taps.clear();
    scene.add(this.camera);
  }

  // What this browser sends the host, 30 times a second.
  readInput() {
    const roleTap = ['Digit1', 'Digit2', 'Digit3'].findIndex((code) => this.taps.has(code));
    const input = {
      keys: {
        KeyW: !!this.keys.KeyW,
        KeyA: !!this.keys.KeyA,
        KeyS: !!this.keys.KeyS,
        KeyD: !!this.keys.KeyD,
        Space: !!this.keys.Space,
      },
      yaw: this.camera.rotation.y,
      pitch: this.camera.rotation.x,
      use: !!this.keys.KeyE,
      // A tap can start and end between two frames, let alone two packets.
      useTap: this.taps.has('KeyE'),
      drop: this.dropRequested,
      role: roleTap >= 0 ? roleTap : null,
    };
    this.taps.clear();
    this.dropRequested = false;
    return input;
  }

  predict(input, dt) {
    stepBody(this.body, input, this.colliders, dt);
    this.syncView();
  }

  // The host's answer arrives late: slide towards it instead of snapping,
  // unless it is so far off that sliding would look like skating.
  correct(x, y, z, strength) {
    const off = Math.abs(this.body.position.x - x) + Math.abs(this.body.position.z - z);
    if (off > 3) this.body.position.set(x, y, z);
    else {
      this.body.position.x += (x - this.body.position.x) * strength;
      this.body.position.y += (y - this.body.position.y) * strength;
      this.body.position.z += (z - this.body.position.z) * strength;
    }
    this.syncView();
  }

  syncView() {
    const { position } = this.body;
    this.camera.position.set(position.x, position.y + PLAYER.eyeHeight - PLAYER.radius, position.z);
  }
}

// The other players: coloured spheres sliding between the last two
// positions the host sent.
export class RemoteCrew {
  constructor(ship, stateHz) {
    this.ship = ship;
    this.step = 1 / stateHz;
    this.crew = new Map(); // id -> { mesh, from, to, t }
  }

  // Add and remove spheres so they match the players in the state.
  sync(players, localId) {
    for (const id of [...this.crew.keys()]) {
      if (!players[id] || id === localId) this.remove(id);
    }
    for (const player of Object.values(players)) {
      if (player.id === localId) continue;
      if (!this.crew.has(player.id)) this.add(player);
      const entry = this.crew.get(player.id);
      entry.mesh.userData.sphere.material.color.set(ROLE_COLORS[player.role] ?? ROLE_COLORS.crew);
    }
  }

  add(player) {
    const mesh = createPlayerMesh(ROLE_COLORS[player.role] ?? ROLE_COLORS.crew);
    mesh.position.set(player.x, player.y, player.z);
    mesh.rotation.y = player.yaw;
    this.ship.add(mesh);
    const at = { x: player.x, y: player.y, z: player.z, yaw: player.yaw };
    this.crew.set(player.id, { mesh, from: { ...at }, to: { ...at }, t: this.step });
  }

  remove(id) {
    const entry = this.crew.get(id);
    if (!entry) return;
    this.ship.remove(entry.mesh);
    this.crew.delete(id);
  }

  // A fresh position from the host becomes the end of the next slide.
  setTarget(player) {
    const entry = this.crew.get(player.id);
    if (!entry) return;
    entry.from = { x: entry.mesh.position.x, y: entry.mesh.position.y, z: entry.mesh.position.z, yaw: entry.mesh.rotation.y };
    entry.to = { x: player.x, y: player.y, z: player.z, yaw: player.yaw };
    entry.t = 0;
  }

  update(dt) {
    for (const entry of this.crew.values()) {
      entry.t = Math.min(this.step, entry.t + dt);
      const k = this.step > 0 ? entry.t / this.step : 1;
      entry.mesh.position.set(
        entry.from.x + (entry.to.x - entry.from.x) * k,
        entry.from.y + (entry.to.y - entry.from.y) * k,
        entry.from.z + (entry.to.z - entry.from.z) * k
      );
      let turn = entry.to.yaw - entry.from.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      entry.mesh.rotation.y = entry.from.yaw + turn * k;
    }
  }

  meshFor(id) {
    return this.crew.get(id)?.mesh ?? null;
  }
}
