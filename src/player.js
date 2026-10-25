// The player: a 0.4 m sphere (for collisions) with the camera at eye
// height. Everyone is drawn as a crew character (character.js): the plain
// deckhand until a uniform is taken, then the mechanic, engineer or pilot.
// You see yourself only in third person (the camera key, C by default).

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { settings } from './settings.js';
import { setRoleBadge } from './roleLook.js';
import { makeCrewMember, lookForRole, characterReady } from './character.js';

export const PLAYER = {
  radius: 0.4,
  eyeHeight: 1.5,
  speed: 4, // metres per second
  jumpSpeed: 4.6,
  gravity: 14,
  // How quickly you get up to speed and stop. Instant movement feels like
  // sliding a cursor; a little momentum feels like a body.
  accel: 30,
  decel: 38,
  airAccel: 9, // you can still steer a jump, just not turn it around
  coyote: 0.12, // seconds after walking off an edge when a jump still works
  // Flying: double-tap jump to take off, jump climbs, the fly-down key
  // sinks, touching the ground while sinking lands you.
  flySpeed: 6,
  flyClimb: 4,
  flyAccel: 16,
  flyMaxHeight: 9, // metres above the ground below you
  doubleTap: 0.3, // seconds between the two jump presses
};

// Third-person camera: distance behind the head (the wheel zooms between
// min and max), and the over-the-shoulder offset.
export const THIRD_PERSON = { distance: 2.8, right: 0.45, up: 0.25, min: 1.2, max: 6 };

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

// A crew character for a role, or (until its model has loaded) a sphere
// with two eyes, so the others can tell which way you face.
export function createPlayerMesh(color = ROLE_COLORS.crew, role = 'crew') {
  const character = makeCrewMember(role, color, PLAYER.radius);
  if (character) {
    const root = character.root;
    root.userData.character = character;
    // The role colour goes on the outfit (main.js recolours via this).
    root.userData.sphere = { material: { color: { set: (c) => character.setColor(c) } } };
    root.userData.badgeHeight = 1.75; // above the head and any hat
    return root;
  }
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
  const character = playerMesh.userData.character;
  if (character) {
    character.attachHat(group);
    character.showHeadgear(hat === 0); // a mirror hat replaces the role's own cap
  } else {
    playerMesh.add(group);
  }
  playerMesh.userData.hat = group;
}

export function createBody(x = 0, y = 0, z = 0) {
  return {
    position: new THREE.Vector3(x, y, z),
    velocityY: 0,
    vx: 0, // horizontal velocity, so starting and stopping take a moment
    vz: 0,
    onGround: true,
    sinceGround: 0, // seconds since last on the ground (coyote time)
    atWheel: false,
    flying: false,
  };
}

// Where a player is looking, in ship space, from the yaw and pitch they sent.
export function lookDirection(yaw, pitch, out = new THREE.Vector3()) {
  const cosPitch = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
}

const _move = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _back = new THREE.Vector3();
const _want = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
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

// Thrown by a storm wall: a short shove that walls still stop.
function applyPush(body, colliders, dt) {
  if (!body.push) return;
  const push = body.push;
  tryMove(body, colliders, push.x * dt, 0, 0);
  tryMove(body, colliders, 0, 0, push.z * dt);
  push.t -= dt;
  if (push.t <= 0) body.push = null;
}

// One step of flight: move toward where the keys point in all three
// directions, a little floatier than walking, never higher than the cap.
function flyStep(body, keys, colliders, dt, groundAt) {
  const scale = PLAYER.flySpeed / PLAYER.speed;
  const tx = _move.x * scale;
  const tz = _move.z * scale;
  const ty = ((keys.Space ? 1 : 0) - (keys.Shift ? 1 : 0)) * PLAYER.flyClimb;
  const dvx = tx - body.vx;
  const dvy = ty - body.velocityY;
  const dvz = tz - body.vz;
  const gap = Math.hypot(dvx, dvy, dvz);
  const step = PLAYER.flyAccel * dt;
  if (gap <= step) {
    body.vx = tx;
    body.velocityY = ty;
    body.vz = tz;
  } else {
    body.vx += (dvx / gap) * step;
    body.velocityY += (dvy / gap) * step;
    body.vz += (dvz / gap) * step;
  }
  if (body.vx !== 0 && !tryMove(body, colliders, body.vx * dt, 0, 0)) body.vx = 0;
  if (body.vz !== 0 && !tryMove(body, colliders, 0, 0, body.vz * dt)) body.vz = 0;
  const sinking = body.velocityY < 0;
  const blocked = body.velocityY !== 0 && !tryMove(body, colliders, 0, body.velocityY * dt, 0);
  body.onGround = false;
  const floor = groundAt(body.position.x, body.position.z) + PLAYER.radius;
  const ceiling = floor + PLAYER.flyMaxHeight;
  if (body.position.y > ceiling) {
    body.position.y = ceiling;
    body.velocityY = Math.min(0, body.velocityY);
  }
  // Coming down onto the floor or onto something solid lands you.
  if (body.position.y <= floor || (blocked && sinking)) {
    if (body.position.y < floor) body.position.y = floor;
    body.velocityY = 0;
    if (sinking) {
      body.flying = false;
      body.onGround = true;
    }
  }
  body.sinceGround = PLAYER.coyote; // no coyote jump out of a flight
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
  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(PLAYER.speed);

  // A double tap of jump toggles flight. The tap is used up here, so a
  // host that steps twice before the next packet does not toggle twice.
  if (input.flyTap) {
    input.flyTap = false;
    body.flying = !body.flying && !body.atWheel;
    if (body.flying) body.velocityY = Math.max(body.velocityY, 1.5); // a little lift-off
  }
  if (body.atWheel) body.flying = false;
  if (body.flying) {
    flyStep(body, keys, colliders, dt, groundAt);
    applyPush(body, colliders, dt);
    return;
  }

  // Velocity eases toward where the keys point: quick on the ground,
  // slower in the air (a jump can be nudged, not reversed).
  body.vx ??= 0;
  body.vz ??= 0;
  const grounded = body.onGround;
  const rate = !grounded ? PLAYER.airAccel : _move.lengthSq() > 0 ? PLAYER.accel : PLAYER.decel;
  const dvx = _move.x - body.vx;
  const dvz = _move.z - body.vz;
  const gap = Math.hypot(dvx, dvz);
  const step = rate * dt;
  if (gap <= step) {
    body.vx = _move.x;
    body.vz = _move.z;
  } else {
    body.vx += (dvx / gap) * step;
    body.vz += (dvz / gap) * step;
  }
  // X and Z separately, so a wall you graze lets you slide along it.
  if (body.vx !== 0 && !tryMove(body, colliders, body.vx * dt, 0, 0)) body.vx = 0;
  if (body.vz !== 0 && !tryMove(body, colliders, 0, 0, body.vz * dt)) body.vz = 0;

  applyPush(body, colliders, dt);

  // Jump if on the ground, or only just off it (walking off a crate edge
  // and pressing jump a moment late should still work).
  body.sinceGround = grounded ? 0 : (body.sinceGround ?? 0) + dt;
  if (keys.Space && !body.atWheel && body.velocityY <= 0 && body.sinceGround < PLAYER.coyote) {
    body.velocityY = PLAYER.jumpSpeed;
    body.onGround = false;
    body.sinceGround = PLAYER.coyote; // one jump per take-off
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
    this.thirdPerson = false;
    this.viewColliders = colliders; // what the third-person camera keeps out of
    this.avatar = null; // your own character, seen in third person
    this.camDistance = THIRD_PERSON.distance;
    this.zoom = THIRD_PERSON.distance; // mouse wheel, in third person
    this.freeLook = null; // while look-around is held: the look the body keeps
    this.lastJump = -Infinity;
    this.history = []; // { at, x, y, z }: see record()

    // The controls only capture the mouse; turning is done below, so the
    // sensitivity and invert settings apply.
    this.controls = new PointerLockControls(camera, document.body);
    this.controls.pointerSpeed = 0;
    this.controls.addEventListener('unlock', () => {
      this.keys = {};
      this.taps.clear();
      this.endFreeLook();
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
      if (repeat) return;
      const bound = settings.keys;
      // Two quick presses of jump: take off, or stop flying.
      if (code === bound.jump) {
        const now = performance.now() / 1000;
        if (now - this.lastJump < PLAYER.doubleTap) {
          this.taps.add('Fly');
          this.lastJump = -Infinity;
        } else {
          this.lastJump = now;
        }
      }
      if (code === bound.camera) this.toggleView();
      // Hold look-around to swing the camera round without turning: the
      // body keeps looking where it looked, the camera orbits.
      if (code === bound.lookAround && !this.freeLook) {
        this.freeLook = { yaw: this.camera.rotation.y, pitch: this.camera.rotation.x };
      }
    };
    const release = (code) => {
      this.keys[code] = false;
      if (code === settings.keys.lookAround) this.endFreeLook();
    };
    addEventListener('keydown', (e) => {
      if (!this.controls.isLocked) return;
      press(e.code, e.repeat);
      // A bound key must not also scroll the page or move browser focus.
      if (Object.values(settings.keys).includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => release(e.code));
    addEventListener('mousedown', (e) => {
      if (this.controls.isLocked) press(`Mouse${e.button}`, false);
    });
    addEventListener('mouseup', (e) => release(`Mouse${e.button}`));
    addEventListener(
      'wheel',
      (e) => {
        if (!this.controls.isLocked || !this.thirdPerson) return;
        this.zoom = Math.min(THIRD_PERSON.max, Math.max(THIRD_PERSON.min, this.zoom + Math.sign(e.deltaY) * 0.4));
      },
      { passive: true }
    );
  }

  // Is the key bound to this action held down right now?
  isDown(action) {
    return !!this.keys[settings.keys[action]];
  }

  // Where the body looks: the camera, unless look-around is swinging it.
  get lookYaw() {
    return this.freeLook ? this.freeLook.yaw : this.camera.rotation.y;
  }
  get lookPitch() {
    return this.freeLook ? this.freeLook.pitch : this.camera.rotation.x;
  }

  // Look-around released: the camera swings back behind you.
  endFreeLook() {
    if (!this.freeLook) return;
    this.camera.rotation.set(this.freeLook.pitch, this.freeLook.yaw, 0);
    this.freeLook = null;
  }

  // The camera key: first person <-> over-the-shoulder third person.
  toggleView(on = !this.thirdPerson) {
    this.thirdPerson = on;
    if (this.avatar) this.avatar.root.visible = on;
    this.syncView();
  }

  // Your own character, built (and rebuilt when your role's look changes)
  // once the model has loaded. It lives in the ship like everyone else's
  // and is only shown in third person.
  ensureAvatar(role, color) {
    const look = lookForRole(role);
    if (this.avatar && this.avatar.role === look) return this.avatar;
    if (this.avatar) this.avatar.root.removeFromParent();
    const root = createPlayerMesh(color, role);
    const character = root.userData.character;
    if (!character) {
      this.avatar = null;
      return null;
    }
    this.avatar = character;
    root.visible = this.thirdPerson;
    this.ship.add(root);
    return character;
  }

  // Drive your own character from your own body: this is what you see in
  // third person, so it uses the predicted position, not the host's.
  updateAvatar(dt, me, extra = {}) {
    const character = this.avatar;
    if (!character) return;
    if (character.root.parent !== this.ship) this.ship.add(character.root);
    character.root.position.copy(this.body.position);
    character.update(dt, {
      pos: this.body.position,
      yaw: this.lookYaw,
      pitch: this.lookPitch,
      air: !this.body.onGround,
      flying: !!this.body.flying,
      atWheel: !!me?.atWheel,
      act: me?.act ?? null,
      uses: me?.uses ?? 0,
      waves: me?.waves ?? 0,
      ...extra,
    });
  }

  // Step into the world at a spot in ship space, camera parented to the ship.
  enter(x, y, z, yaw = -Math.PI / 2) {
    this.body.position.set(x, y, z);
    this.body.velocityY = 0;
    this.body.vx = 0;
    this.body.vz = 0;
    this.body.onGround = true;
    this.body.atWheel = false;
    this.body.flying = false;
    this.keys = {};
    this.taps.clear();
    this.forget();
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
        Shift: this.isDown('flyDown'),
      },
      yaw: this.lookYaw,
      pitch: this.lookPitch,
      use: this.isDown('interact'),
      // A tap can start and end between two frames, let alone two packets.
      useTap: this.taps.has(bound.interact),
      drop: this.taps.has(bound.drop),
      bell: this.taps.has(bound.bell),
      callout: this.taps.has(bound.callout),
      wave: this.taps.has(bound.wave),
      flyTap: this.taps.has('Fly'),
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

  // Where the body has been, frame by frame (a joiner's last two seconds),
  // so the host's answer can be checked against where we were when it
  // was true rather than against where we are now.
  record(now) {
    const { x, y, z } = this.body.position;
    this.history.push({ at: now, x, y, z });
    while (this.history.length && now - this.history[0].at > 2000) this.history.shift();
  }

  forget() {
    this.history.length = 0;
  }

  // The host says we stood at x, y, z at the moment `at` (our clock).
  // Walking, its answer always trails where we are by the round trip;
  // pulling towards it would drag us back with every packet. Instead, only
  // the difference between its answer and where we ourselves were at that
  // moment is real: a little of that is mended at a time, and the history
  // is moved along with it so the same error is not mended twice.
  reconcile(x, y, z, at, strength) {
    const history = this.history;
    let past = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].at <= at) {
        past = history[i];
        break;
      }
    }
    if (!past) {
      this.correct(x, y, z, strength);
      return;
    }
    const ex = x - past.x;
    const ey = y - past.y;
    const ez = z - past.z;
    if (Math.abs(ex) + Math.abs(ez) > 3) {
      // Sent somewhere else entirely (back to the dock, a reconnect).
      this.body.position.set(x, y, z);
      this.forget();
      this.syncView();
      return;
    }
    if (Math.abs(ex) + Math.abs(ey) + Math.abs(ez) < 0.02) return; // close enough: no shimmer
    const dx = ex * strength;
    const dy = ey * strength;
    const dz = ez * strength;
    this.body.position.x += dx;
    this.body.position.y += dy;
    this.body.position.z += dz;
    for (const sample of history) {
      sample.x += dx;
      sample.y += dy;
      sample.z += dz;
    }
    this.syncView();
  }

  // The camera sits at eye height, dipping and swaying a little with each
  // step while you walk (unless head bob is off in the settings).
  // Where the eyes are, in ship space.
  eye(out = new THREE.Vector3()) {
    const { position } = this.body;
    return out.set(position.x, position.y + PLAYER.eyeHeight - PLAYER.radius, position.z);
  }

  syncView(dt = 0) {
    if (this.thirdPerson) {
      this.thirdPersonView(dt);
      return;
    }
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

  // Over the right shoulder, pulled in when a wall is in the way so the
  // camera never ends up inside the hull. While look-around is held the
  // camera's own rotation swings it round you (the body keeps its look).
  thirdPersonView(dt) {
    const eye = this.eye(_eye);
    const yaw = this.camera.rotation.y;
    const back = lookDirection(yaw, this.camera.rotation.x, _back).negate();
    _want.copy(back).multiplyScalar(this.zoom);
    _want.x += Math.cos(yaw) * THIRD_PERSON.right;
    _want.z -= Math.sin(yaw) * THIRD_PERSON.right;
    _want.y += THIRD_PERSON.up;
    const full = _want.length();
    _ray.origin.copy(eye);
    _ray.direction.copy(_want).divideScalar(full);
    let reach = full;
    for (const box of this.viewColliders ?? []) {
      if (box.containsPoint(eye)) continue;
      const hit = _ray.intersectBox(box, _hit);
      if (hit) reach = Math.min(reach, hit.distanceTo(eye) - 0.25);
    }
    reach = Math.max(0.3, reach);
    // Pull in at once, ease back out, so it never clips but never jitters.
    // (Calls without dt only place the camera; the easing happens once a frame.)
    let distance = Math.min(this.camDistance, reach);
    if (dt) {
      distance = reach < this.camDistance ? reach : this.camDistance + (reach - this.camDistance) * Math.min(1, dt * 4);
      this.camDistance = distance;
    }
    this.camera.position.copy(eye).addScaledVector(_ray.direction, distance);
  }
}

// The other players: crew characters following the positions the host
// sent, a moment behind, animated from how they move. Each wears its
// role's outfit once the uniform is taken.
export class RemoteCrew {
  constructor(ship, stateHz) {
    this.ship = ship;
    // How far behind the crew are shown, in ms: two state packets, so one
    // late packet never leaves anyone standing still. The host, which
    // simulates everyone itself, sets this to 0.
    this.delay = 2000 / stateHz;
    this.crew = new Map(); // id -> { mesh, samples, info }
  }

  // Add and remove crew so they match the players in the state, and swap a
  // model when its look should change (a uniform taken, a model loaded).
  sync(players, localId) {
    for (const id of [...this.crew.keys()]) {
      if (!players[id] || id === localId) this.remove(id);
    }
    for (const player of Object.values(players)) {
      if (player.id === localId) continue;
      if (!this.crew.has(player.id)) this.add(player);
      const entry = this.crew.get(player.id);
      entry.info = player;
      const character = entry.mesh.userData.character;
      const stale = character ? character.role !== lookForRole(player.role) : characterReady();
      if (stale) this.swapModel(player.id, player);
      const color = ROLE_COLORS[player.role] ?? ROLE_COLORS.crew;
      entry.mesh.userData.sphere.material.color.set(color);
      setHat(entry.mesh, player.hat ?? 0);
      setRoleBadge(entry.mesh, player.role, color, settings.roleSymbols);
    }
  }

  add(player) {
    const mesh = createPlayerMesh(ROLE_COLORS[player.role] ?? ROLE_COLORS.crew, player.role);
    mesh.position.set(player.x, player.y, player.z);
    if (!mesh.userData.character) mesh.rotation.y = player.yaw;
    this.ship.add(mesh);
    const sample = { at: 0, x: player.x, y: player.y, z: player.z, yaw: player.yaw ?? 0, pitch: player.pitch ?? 0 };
    this.crew.set(player.id, { mesh, samples: [sample], info: player });
  }

  // A new model for the same player, picking up where the old one stood.
  swapModel(id, player) {
    const entry = this.crew.get(id);
    if (!entry) return;
    const old = entry.mesh;
    const mesh = createPlayerMesh(ROLE_COLORS[player.role] ?? ROLE_COLORS.crew, player.role);
    mesh.position.copy(old.position);
    // Anything held (kit, bucket, fuse) is re-parented by main.js next frame.
    for (const child of [...old.children]) {
      if (child.name === 'patchKit' || child.userData.held) child.removeFromParent();
    }
    this.ship.remove(old);
    this.ship.add(mesh);
    entry.mesh = mesh;
  }

  // The character model arrived after some spheres were made: swap them.
  rebuild() {
    for (const [id, entry] of this.crew) this.swapModel(id, entry.info);
  }

  remove(id) {
    const entry = this.crew.get(id);
    if (!entry) return;
    this.ship.remove(entry.mesh);
    this.crew.delete(id);
  }

  // A fresh position from the host, stamped with when it was true (on this
  // browser's clock). Kept in a short queue that update() plays back a
  // little behind, so packets that bunch up or run late still give a
  // steady walk instead of a stop-start one.
  setTarget(player, at = performance.now()) {
    const entry = this.crew.get(player.id);
    if (!entry) return;
    entry.info = player;
    const sample = { at, x: player.x, y: player.y, z: player.z, yaw: player.yaw ?? 0, pitch: player.pitch ?? 0 };
    const last = entry.samples[entry.samples.length - 1];
    if (last && at <= last.at) entry.samples[entry.samples.length - 1] = { ...sample, at: last.at };
    else entry.samples.push(sample);
    if (entry.samples.length > 60) entry.samples.shift();
  }

  // Where a player was at a moment: between the two samples either side
  // of it, or the nearest end if it falls outside them. A big jump (sent
  // back to the dock) is a jump, not a slide across the deck.
  sampleAt(entry, at) {
    const samples = entry.samples;
    while (samples.length > 2 && samples[1].at <= at) samples.shift();
    const a = samples[0];
    const b = samples[1];
    if (!b || at <= a.at) return a;
    if (at >= b.at) return b;
    if (Math.abs(b.x - a.x) + Math.abs(b.z - a.z) > 3) return b;
    const k = (at - a.at) / (b.at - a.at);
    let turn = b.yaw - a.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      z: a.z + (b.z - a.z) * k,
      yaw: a.yaw + turn * k,
      pitch: a.pitch + (b.pitch - a.pitch) * k,
    };
  }

  // ctx: { kitHolder, wheelYaw, steering } from the shared state.
  update(dt, ctx = {}, now = performance.now()) {
    const showAt = now - this.delay;
    for (const [id, entry] of this.crew) {
      const propeller = entry.mesh.getObjectByName('propeller');
      if (propeller) propeller.rotation.y += dt * 12;
      const { x, y, z, yaw, pitch } = this.sampleAt(entry, showAt);
      entry.mesh.position.set(x, y, z);

      const character = entry.mesh.userData.character;
      if (!character) {
        entry.mesh.rotation.y = yaw;
        continue;
      }
      const info = entry.info ?? {};
      character.update(dt, {
        pos: entry.mesh.position,
        yaw,
        pitch,
        air: info.air,
        flying: !!info.flying,
        atWheel: !!info.atWheel,
        bodyYaw: info.atWheel ? ctx.wheelYaw : undefined,
        steering: info.atWheel ? ctx.steering : 0,
        carrying: ctx.kitHolder === id || !!info.bucket,
        act: info.act ?? null,
        uses: info.uses ?? 0,
        waves: info.waves ?? 0,
      });
    }
  }

  meshFor(id) {
    return this.crew.get(id)?.mesh ?? null;
  }
}
