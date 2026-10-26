// The sky pirates as everyone sees them, drawn from state.raid (game.js
// decides everything): their airship holding station off the bow, in
// sight of the bow window and the pilot's telescope; its crew on deck;
// cannon fire; grapples biting through our walls, with their lines; and
// the boarders on our deck, to cut free of and shove overboard.
//
// public/models/pirate_ship.glb and pirates.glb come from
// art/scripts/build_pirates.py. Until they load the raid still works: the
// hooks and the boarders' targets are built here in code.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RULES } from './state.js';
import { HOOK_HEIGHT, HOOK_SPOTS, SHIP, hookX } from './world.js';
import { loadPirates, makePirate } from './character.js';
import { softenMetal } from './rooms.js';
import { play } from './sound.js';

const SHIP_URL = `${import.meta.env.BASE_URL}models/pirate_ship.glb`;

// Where their ship holds station, in our ship's space: ahead and off to
// one side, far enough out that its hull clears ours, near enough to the
// bow that the helm sees it through the window.
const ALONGSIDE = { x: 23, z: 8, y: -0.6 };
const SIGHTED_FROM = { x: 150, z: 32 }; // out of the fog
const RAIL = { x: [-2, 1, 4], z: 2.5, y: 0.9 }; // where their grapple lines leave the rail

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (k) => k * k * (3 - 2 * k);
const unaimable = (root) => root.traverse((o) => (o.raycast = () => {}));

// Where their ship is (its centre, in our ship's space) for a raid.
export function pirateShipPose(raid) {
  const side = raid.side;
  const approach = (k) => ({
    x: lerp(SIGHTED_FROM.x, ALONGSIDE.x, smooth(k)),
    z: side * lerp(SIGHTED_FROM.z, ALONGSIDE.z, smooth(k)),
  });
  if (raid.phase === 'sighted') return { ...approach(Math.min(1, raid.t / RULES.raidApproach)), visible: true };
  if (raid.phase === 'alongside') return { ...approach(1), visible: true };
  if (raid.phase === 'leaving') {
    const start = approach(raid.from ?? 1);
    const k = smooth(Math.min(1, raid.t / RULES.raidLeaveSeconds));
    // Outrun, they drop away astern; otherwise they veer off.
    const end = raid.ending === 'outrun' ? { x: -90, z: side * 30 } : { x: start.x + 50, z: side * 70 };
    return { x: lerp(start.x, end.x, k), z: lerp(start.z, end.z, k), visible: raid.t < RULES.raidLeaveSeconds };
  }
  return { x: 0, z: 0, visible: false };
}

const iron = new THREE.MeshStandardMaterial({ color: '#5b616f', metalness: 0.3, roughness: 0.5, flatShading: true });
const splinter = new THREE.MeshStandardMaterial({ color: '#3a2418', flatShading: true });
const rope = new THREE.MeshStandardMaterial({ color: '#b89a6a', flatShading: true });
const unseen = new THREE.MeshBasicMaterial({ visible: false });

// A grapple through the wall: splintered planks, three iron tines curling
// in, a stub of line. And a block in front to aim at: the tines are thin.
function buildHook(ship, x, side) {
  const group = new THREE.Group();
  const wallZ = side * (SHIP.width / 2 - SHIP.thickness / 2 - 0.01);
  group.position.set(x, HOOK_HEIGHT, wallZ);
  group.visible = false;
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.04), splinter);
  patch.rotation.z = 0.3;
  group.add(patch);
  for (let k = 0; k < 3; k++) {
    const tine = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 5), iron);
    const a = (k / 3) * Math.PI * 2;
    tine.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, -side * 0.16);
    tine.rotation.set(-side * (Math.PI / 2 - 0.5), 0, a - Math.PI / 2);
    group.add(tine);
  }
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), iron);
  shank.rotation.x = Math.PI / 2;
  shank.position.z = -side * 0.08;
  group.add(shank);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), rope);
  stub.rotation.x = Math.PI / 2;
  stub.position.z = side * 0.2;
  group.add(stub);
  unaimable(group);
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.7), unseen);
  target.position.z = -side * 0.3;
  target.userData.hookInteract = { label: 'Cut the grapple (hold)', action: 'cutHook', hold: RULES.cutSeconds, hook: null };
  group.add(target);
  ship.add(group);
  return { group, target };
}

function buildRope(ship) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), rope);
  mesh.visible = false;
  mesh.raycast = () => {};
  ship.add(mesh);
  return mesh;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
function stretch(mesh, from, to) {
  _dir.subVectors(to, from);
  const length = _dir.length();
  mesh.position.copy(from).addScaledVector(_dir, 0.5);
  mesh.quaternion.setFromUnitVectors(_up, _dir.normalize());
  mesh.scale.set(1, length, 1);
}

export function buildPirates(world) {
  const ship = world.ship;
  const holder = new THREE.Group();
  holder.name = 'pirateShip';
  holder.visible = false;
  ship.add(holder);

  const hooks = {}; // `${spot}:${side}` -> { group, target }
  HOOK_SPOTS.forEach((_, spot) => {
    for (const side of [-1, 1]) hooks[`${spot}:${side}`] = buildHook(ship, hookX(spot, side), side);
  });

  const effects = new THREE.Group(); // flashes, smoke, cannonballs
  ship.add(effects);

  world.pirates = {
    holder,
    model: null,
    cannons: { 1: [], [-1]: [] }, // muzzles that face us when we are on that side of them
    propellers: [],
    deck: null, // their crew, once the models are in
    hooks,
    ropes: HOOK_SPOTS.map(() => buildRope(ship)),
    boarders: new Map(), // id -> { root, character, target, kind }
    effects,
    shots: [], // { kind, mesh, start, life, from, to }
  };
  loadShip(world.pirates);
  loadPirates();
}

async function loadShip(pir) {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(SHIP_URL);
  } catch (err) {
    console.warn('Pirate ship model missing, the raid goes on unseen:', err);
    return;
  }
  const model = gltf.scene;
  model.traverse((obj) => {
    if (obj.material) {
      obj.material = obj.material.clone();
      softenMetal(obj.material);
      if (obj.name.startsWith('lamp_red') || obj.name.startsWith('cabin_window')) {
        obj.material.emissive = obj.material.color.clone();
        obj.material.emissiveIntensity = 1.4;
      }
    }
    if (obj.name.startsWith('spin_prop_')) pir.propellers.push(obj);
  });
  unaimable(model);
  // The muzzles facing us: we are on their -z side when they hold station
  // to our starboard. Measured before the model joins the holder, while
  // its own space is the holder's.
  model.updateMatrixWorld(true);
  model.traverse((obj) => {
    if (!/^cannon_muzzle_[PS]\d$/.test(obj.name)) return;
    const at = obj.getWorldPosition(new THREE.Vector3());
    pir.cannons[at.z < 0 ? 1 : -1].push(at);
  });
  pir.holder.add(model);
  pir.model = model;
}

// Their crew on deck, once both the crew skeleton and the pirates load.
// Who stands where, in their ship's space; z is how far toward our side
// of their deck (flipped to whichever side that is).
const DECK = {
  captain: { x: -5, y: 2.24, z: 0 }, // at the wheel on the cabin roof
  lookout: { x: 1.5, y: 3.6, z: 0 }, // in the crow's nest
  gunner: { x: -1.4, y: 0, z: 1.2 },
  bosun: { x: -3, y: 0, z: 0.4 },
  deckhand: { x: 3, y: 0, z: 0.9 },
};
function crewDeck(pir) {
  if (pir.deck) return pir.deck;
  const deck = {};
  for (const name of Object.keys(DECK)) {
    const character = makePirate(name);
    if (!character) return null;
    unaimable(character.root);
    pir.holder.add(character.root);
    deck[name] = { character, waves: 0, waveIn: 2 + Math.random() * 6 };
  }
  pir.deck = deck;
  return deck;
}

// When the last cannonball hit home, for the camera's jolt.
let lastHit = -Infinity;
export function lastPirateHit() {
  return lastHit;
}

const seen = { count: null, shots: 0, blocked: 0, overboard: 0, hooks: new Set() };

// Every frame. me: this browser's player (for the shove prompt).
export function updatePirates(world, state, { now, dt, me }) {
  const pir = world.pirates;
  if (!pir) return;
  const raid = state.raid;
  const flying = state.phase === 'flight';

  // Their ship, bobbing a little out of step with ours.
  const pose = pirateShipPose(raid);
  pir.holder.visible = flying && pose.visible;
  if (pir.holder.visible) {
    pir.holder.position.set(pose.x, ALONGSIDE.y + Math.sin(now / 900) * 0.4, pose.z);
    pir.holder.rotation.set(Math.sin(now / 1700) * 0.03, 0, Math.sin(now / 1300) * 0.04);
    for (const prop of pir.propellers) prop.rotation.x += dt * 18;
    updateDeck(pir, raid, now, dt);
  }

  updateHooks(pir, raid, flying, now);
  updateBoarders(pir, raid, flying, me, now, dt);
  updateShots(pir, raid, flying, now);
}

function updateDeck(pir, raid, now, dt) {
  const deck = crewDeck(pir);
  if (!deck) return;
  const towardUs = -raid.side; // their local z that points at us
  const aboard = new Set(Object.values(raid.boarders).map((b) => b.kind));
  const yaw = raid.side > 0 ? 0 : Math.PI; // facing us
  for (const [name, spot] of Object.entries(DECK)) {
    const member = deck[name];
    const root = member.character.root;
    root.visible = !aboard.has(name);
    if (!root.visible) continue;
    root.position.set(spot.x, spot.y + member.character.footOffset, towardUs * spot.z);
    // The captain shakes a fist (well, waves) at us now and then.
    member.waveIn -= dt;
    if (member.waveIn <= 0) {
      member.waves += 1;
      member.waveIn = 4 + Math.random() * 6;
    }
    member.character.update(dt, { pos: root.position, yaw, pitch: 0, air: false, waves: member.waves });
  }
}

function updateHooks(pir, raid, flying, now) {
  const live = flying && raid.phase === 'alongside' ? raid.hooks : {};
  const shown = new Set();
  let rope = 0;
  for (const [id, hook] of Object.entries(live)) {
    const key = `${hook.spot}:${raid.side}`;
    const built = pir.hooks[key];
    if (!built) continue;
    shown.add(key);
    built.group.visible = true;
    built.target.userData.interact = { ...built.target.userData.hookInteract, hook: id };
    if (!seen.hooks.has(id) && seen.count !== null) play('engineer_lever_clunk', 0.7); // it bites
    // The line runs from their rail to the outside of our wall.
    const line = pir.ropes[rope++];
    if (line && pir.holder.visible) {
      pir.holder.updateMatrix();
      const from = new THREE.Vector3(RAIL.x[hook.spot] ?? 0, RAIL.y, -raid.side * RAIL.z).applyMatrix4(pir.holder.matrix);
      const to = new THREE.Vector3(hookX(hook.spot, raid.side), HOOK_HEIGHT, raid.side * (SHIP.width / 2 + 0.1));
      // A taut line sags a little as the ships roll.
      to.y += Math.sin(now / 700 + hook.spot) * 0.03;
      stretch(line, from, to);
      line.visible = true;
    }
  }
  for (let i = rope; i < pir.ropes.length; i++) pir.ropes[i].visible = false;
  for (const [key, built] of Object.entries(pir.hooks)) {
    if (shown.has(key)) continue;
    built.group.visible = false;
    built.target.userData.interact = null;
  }
  seen.hooks = new Set(Object.keys(live));
}

function makeBoarder(kind) {
  const character = makePirate(kind);
  let root;
  if (character) {
    root = character.root;
    unaimable(root);
  } else {
    // The models are not in yet: a pirate-red ball with a bandana stripe.
    root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshStandardMaterial({ color: '#8e2b2b', flatShading: true }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 6, 16), new THREE.MeshStandardMaterial({ color: '#c9443a' }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.18;
    root.add(body, band);
    unaimable(root);
  }
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.9), unseen);
  target.position.y = 0.5; // body centre to the top of the head
  root.add(target);
  return { root, character, target, kind };
}

function updateBoarders(pir, raid, flying, me, now, dt) {
  const live = flying && raid.phase === 'alongside' ? raid.boarders : {};
  for (const [id, entry] of pir.boarders) {
    if (live[id]) continue;
    entry.root.removeFromParent();
    pir.boarders.delete(id);
  }
  for (const [id, b] of Object.entries(live)) {
    let entry = pir.boarders.get(id);
    if (!entry) {
      entry = makeBoarder(b.kind);
      entry.root.position.set(b.x, b.y, b.z);
      pir.holder.parent.add(entry.root); // our ship
      pir.boarders.set(id, entry);
    }
    // Ease toward where the host has them: smooth between packets.
    const k = Math.min(1, dt * 12);
    entry.root.position.x = lerp(entry.root.position.x, b.x, k);
    entry.root.position.y = lerp(entry.root.position.y, b.y, k);
    entry.root.position.z = lerp(entry.root.position.z, b.z, k);
    const left = RULES.shovesToRepel - b.shoves;
    const label = me?.bucket
      ? 'Splash him overboard'
      : left <= 1
        ? 'Shove him overboard'
        : `Shove back (${left} to go)`;
    entry.target.userData.interact = { label, action: 'shove', boarder: id };
    const high = b.y > 0.45;
    if (entry.character) {
      entry.character.update(dt, {
        pos: entry.root.position,
        yaw: b.yaw,
        pitch: 0,
        air: high && b.kind !== 'deckhand',
        flying: high && b.kind === 'deckhand',
        waves: b.waves,
      });
    } else {
      entry.root.rotation.y = b.yaw;
    }
  }
  if (seen.count !== null && raid.overboard > seen.overboard) play('mechanic_furnace_whoosh', 0.7); // over the side
  seen.overboard = raid.overboard;
}

// Cannon fire: a flash and smoke at one of their muzzles, a ball across
// the gap, and at our hull either the shields' blue flare or a hit (the
// hole itself is the host's, in state.breaches).
function updateShots(pir, raid, flying, now) {
  if (seen.count === null || raid.count !== seen.count) {
    // A new raid or a new session: no old news replayed.
    seen.count = raid.count;
    seen.shots = raid.shots;
    seen.blocked = raid.blocked;
  }
  if (raid.shots > seen.shots) {
    const blocked = raid.blocked > seen.blocked;
    seen.shots = raid.shots;
    seen.blocked = raid.blocked;
    if (flying) fire(pir, raid, blocked, now);
  }
  for (let i = pir.shots.length - 1; i >= 0; i--) {
    const shot = pir.shots[i];
    const k = (now - shot.start) / shot.life;
    if (k >= 1) {
      shot.mesh.removeFromParent();
      pir.shots.splice(i, 1);
      continue;
    }
    if (shot.kind === 'ball') shot.mesh.position.lerpVectors(shot.from, shot.to, k).y += Math.sin(k * Math.PI) * 0.8;
    else {
      shot.mesh.scale.setScalar(shot.grow[0] + (shot.grow[1] - shot.grow[0]) * k);
      shot.mesh.material.opacity = shot.fade * (1 - k);
    }
  }
}

function puff(pir, at, { color, size, grow, life, fade = 0.9, now }) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fade, depthWrite: false })
  );
  mesh.position.copy(at);
  mesh.raycast = () => {};
  pir.effects.add(mesh);
  pir.shots.push({ kind: 'puff', mesh, start: now, life, grow, fade });
}

function fire(pir, raid, blocked, now) {
  const muzzles = pir.cannons[raid.side];
  const local = muzzles.length
    ? muzzles[raid.shots % muzzles.length].clone()
    : new THREE.Vector3(0, 0.5, -raid.side * 2.6);
  pir.holder.updateMatrix();
  const from = local.applyMatrix4(pir.holder.matrix); // in our ship's space, like everything here
  const to = new THREE.Vector3(-8 + Math.random() * 16, 1.2, raid.side * (SHIP.width / 2 + 0.3));
  puff(pir, from, { color: '#ffb347', size: 0.5, grow: [0.6, 2.2], life: 220, fade: 1, now });
  puff(pir, from, { color: '#8a8580', size: 0.7, grow: [0.8, 3.5], life: 1300, fade: 0.6, now });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#1d1b22' }));
  ball.raycast = () => {};
  pir.effects.add(ball);
  pir.shots.push({ kind: 'ball', mesh: ball, start: now, life: 450, from: from.clone(), to });
  play('mechanic_cannonball_rack_clunk', 0.8);
  // Where it lands, a moment later.
  setTimeout(() => {
    const at = performance.now();
    if (blocked) puff(pir, to, { color: '#7fd4ff', size: 0.8, grow: [0.5, 2.6], life: 450, fade: 0.55, now: at });
    else {
      puff(pir, to, { color: '#5a3418', size: 0.4, grow: [0.5, 1.8], life: 600, fade: 0.8, now: at });
      lastHit = at;
      play('engineer_lever_clunk', 0.9);
    }
  }, 450);
}

// Back at the menu: a new session starts without old news, and nothing
// of the last raid is left standing.
export function resetPirateEffects(world) {
  seen.count = null;
  seen.hooks = new Set();
  const pir = world?.pirates;
  if (!pir) return;
  for (const entry of pir.boarders.values()) entry.root.removeFromParent();
  pir.boarders.clear();
  for (const shot of pir.shots) shot.mesh.removeFromParent();
  pir.shots.length = 0;
  pir.holder.visible = false;
}
