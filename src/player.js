// The player: a 0.4 m sphere with the camera at eye height inside it.
// You never see your own sphere, only the other players'.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { settings } from './settings.js';
import { setRoleBadge } from './roleLook.js';

export const PLAYER = {
  radius: 0.4,
  eyeHeight: 1.5,
  speed: 4, // metres per second
  jumpSpeed: 4.6,
  gravity: 14,
};

// Swapped in place by main.js when the colour-blind palette changes.
export const ROLE_COLORS = {
  mechanic: '#e2574c',
  engineer: '#49b97a',
  pilot: '#4a86e8',
  crew: '#d9d2c5', // before a role is picked
};

// Mouse look: radians per pixel at sensitivity 50. The slider doubles or
// halves it every 25 steps, so 0..100 spans a quarter to four times.
const LOOK_SPEED = 0.002;
const lookScale = () => 2 ** ((settings.sensitivity - 50) / 25);
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// Head bob: one dip per footstep, about 2.8 steps a second at full speed.
const BOB = { perMetre: 2.2, height: 0.035, sway: 0.022 };

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

// Hats from the dock mirror, sitting on top of a sphere. Index matches
// HATS in state.js; 0 is bare.
const HAT_PARTS = [
  () => [],
  () => [part(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f2a33a', 0, 0.26, 0)],
  () => [
    part(new THREE.CylinderGeometry(0.3, 0.32, 0.18, 14), '#1d3d7a', 0, 0.42, 0),
    part(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), '#0c1f42', 0, 0.34, -0.14),
    part(new THREE.SphereGeometry(0.05, 8, 6), '#ffd58a', 0, 0.44, -0.3),
  ],
  () => [
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 14), '#22202a', 0, 0.56, 0),
    part(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), '#22202a', 0, 0.36, 0),
    part(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 14), '#c9443a', 0, 0.42, 0),
  ],
  () => [
    part(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#4a86e8', 0, 0.28, 0),
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), '#6b7183', 0, 0.62, 0),
    part(new THREE.BoxGeometry(0.5, 0.02, 0.08), '#ffd84d', 0, 0.7, 0, 'propeller'),
  ],
];

function part(geometry, color, x, y, z, name = '') {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true }));
  mesh.position.set(x, y, z);
  mesh.name = name;
  return mesh;
}

export function setHat(playerMesh, hat = 0) {
  if (playerMesh.userData.hatIndex === hat) return;
  playerMesh.userData.hatIndex = hat;
  playerMesh.userData.hat?.removeFromParent();
  const group = new THREE.Group();
  for (const mesh of (HAT_PARTS[hat] ?? HAT_PARTS[0])()) group.add(mesh);
  playerMesh.add(group);
  playerMesh.userData.hat = group;
}

export function createBody(x = 0, y = 0, z = 0) {
  return {
    position: new THREE.Vector3(x, y, z),
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
export function stepBody(body, input, colliders, dt, groundAt = () => 0) {
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

  // The floor is never a collider: a sphere resting on one would overlap
  // it and block every step. It is a height you cannot sink below, which
  // is also what lets the gangplank be walked up.
  const floor = groundAt(body.position.x, body.position.z) + PLAYER.radius;
  if (body.position.y < floor) {
    body.position.y = floor;
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
    // Held keys and mouse buttons by code (KeyW, Mouse2), and the ones
    // pressed since the last input was read. Only while the mouse is
    // captured: typing a name or rebinding a key must not walk you around.
    this.keys = {};
    this.taps = new Set();
    this.bob = { phase: 0, amount: 0, x: 0, z: 0 };

    // The controls only capture the mouse; turning is done below, so the
    // sensitivity and invert settings apply.
    this.controls = new PointerLockControls(camera, document.body);
    this.controls.pointerSpeed = 0;
    this.controls.addEventListener('unlock', () => {
      this.keys = {};
      this.taps.clear();
    });

    addEventListener('mousemove', (e) => {
      if (!this.controls.isLocked) return;
      const speed = LOOK_SPEED * lookScale();
      const camera = this.camera;
      camera.rotation.y -= e.movementX * speed;
      camera.rotation.x -= e.movementY * speed * (settings.invertY ? -1 : 1);
      camera.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camera.rotation.x));
    });

    const press = (code, repeat) => {
      this.keys[code] = true;
      if (!repeat) this.taps.add(code);
    };
    addEventListener('keydown', (e) => {
      if (!this.controls.isLocked) return;
      press(e.code, e.repeat);
      // A bound key must not also scroll the page or move browser focus.
      if (Object.values(settings.keys).includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    addEventListener('mousedown', (e) => {
      if (this.controls.isLocked) press(`Mouse${e.button}`, false);
    });
    addEventListener('mouseup', (e) => (this.keys[`Mouse${e.button}`] = false));
  }

  // Is the key bound to this action held down right now?
  isDown(action) {
    return !!this.keys[settings.keys[action]];
  }

  // Step into the world at a spot in ship space, camera parented to the ship.
  enter(x, y, z, yaw = -Math.PI / 2) {
    this.body.position.set(x, y, z);
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
  // The host only ever sees KeyW/KeyA/KeyS/KeyD/Space, whatever the
  // player has bound them to, so rebinding needs nothing from the host.
  readInput() {
    const bound = settings.keys;
    const input = {
      keys: {
        KeyW: this.isDown('forward'),
        KeyA: this.isDown('left'),
        KeyS: this.isDown('back'),
        KeyD: this.isDown('right'),
        Space: this.isDown('jump'),
      },
      yaw: this.camera.rotation.y,
      pitch: this.camera.rotation.x,
      use: this.isDown('interact'),
      // A tap can start and end between two frames, let alone two packets.
      useTap: this.taps.has(bound.interact),
      drop: this.taps.has(bound.drop),
      bell: this.taps.has(bound.bell),
    };
    this.taps.clear();
    return input;
  }

  predict(input, dt, colliders, groundAt) {
    stepBody(this.body, input, colliders ?? this.colliders, dt, groundAt);
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

  // The camera sits at eye height, dipping and swaying a little with each
  // step while you walk (unless head bob is off in the settings).
  syncView() {
    const { position } = this.body;
    const bob = this.bob;
    const moved = Math.hypot(position.x - bob.x, position.z - bob.z);
    bob.x = position.x;
    bob.z = position.z;
    const walking = settings.headBob && this.body.onGround && moved > 0.001 && moved < 0.5;
    if (walking) bob.phase += moved * BOB.perMetre * Math.PI;
    bob.amount += ((walking ? 1 : 0) - bob.amount) * 0.12;
    if (!settings.headBob) bob.amount = 0;

    const dip = Math.sin(bob.phase * 2) * BOB.height * bob.amount;
    const sway = Math.sin(bob.phase) * BOB.sway * bob.amount;
    const yaw = this.camera.rotation.y;
    this.camera.position.set(
      position.x + Math.cos(yaw) * sway,
      position.y + PLAYER.eyeHeight - PLAYER.radius + dip,
      position.z - Math.sin(yaw) * sway
    );
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
      const color = ROLE_COLORS[player.role] ?? ROLE_COLORS.crew;
      entry.mesh.userData.sphere.material.color.set(color);
      setHat(entry.mesh, player.hat ?? 0);
      setRoleBadge(entry.mesh, player.role, color, settings.roleSymbols);
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
      const propeller = entry.mesh.getObjectByName('propeller');
      if (propeller) propeller.rotation.y += dt * 12;
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
