// Creates the renderer and camera, runs the loop, switches screens, and
// joins the two halves of a session: the host simulating, everyone drawing.

import * as THREE from 'three';
import { buildShip, addLights, addSky, applyState, groundHeight } from './world.js';
import { LocalPlayer, RemoteCrew, createBody, stepBody } from './player.js';
import { InteractionView, HostInteractions } from './interact.js';
import { Net, makeCode } from './network.js';
import {
  RULES,
  applySnapshot,
  local,
  newPlayer,
  playerCount,
  snapshot,
  state,
} from './state.js';
import * as game from './game.js';
import { showScreen, currentScreen } from './screens.js';
import { initMenu, playerName } from './menu.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
addSky(scene);
addLights(scene);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);
// PointerLockControls turns the camera as yaw then pitch; reading the angles
// back only gives that pair if the euler is decomposed in the same order.
camera.rotation.order = 'YXZ';

const world = buildShip();
const ship = world.ship;
scene.add(ship);

const player = new LocalPlayer({ ship, camera, colliders: world.colliders });
const crew = new RemoteCrew(ship, RULES.stateHz);
const view = new InteractionView({
  ship,
  camera,
  player,
  roleOf: () => state.players[local.id]?.role ?? 'crew',
  mayUse: game.mayUse,
});

const net = new Net();
const hostInteractions = new HostInteractions(ship);
const bodies = new Map(); // host only: player id -> body it simulates
const inputs = new Map(); // host only: player id -> the input last heard

const playUi = document.getElementById('play');
const lockOverlay = document.getElementById('lockOverlay');
const statusLine = document.getElementById('status');
const banner = document.getElementById('banner');
const menuNote = document.getElementById('menuNote');
const joinError = document.getElementById('joinError');
const KIT_INTERACT = world.kit.userData.interact;

const inWorld = () => currentScreen() === 'lobby' || currentScreen() === 'flight';

// Where the floor is, and what blocks you, both depend on the phase: at
// the dock there is a platform, a gangplank and an open cargo door.
const groundAt = (x, z) => groundHeight(x, z, state.phase);
function collidersFor(role) {
  if (state.phase === 'flight') return world.flightColliders;
  // The gangplank is barred until you are wearing a uniform.
  return role === 'crew' ? world.lobbyGatedColliders : world.lobbyColliders;
}

const emptyInput = () => ({
  keys: {},
  yaw: -Math.PI / 2,
  pitch: 0,
  use: false,
  useTap: false,
  drop: false,
  role: null,
});

// --- the host's side of a session ------------------------------------

net.onHello = (name) => {
  if (playerCount() >= RULES.maxPlayers) return null; // "Ship is full"
  const index = playerCount();
  const seated = newPlayer(`p${index}`, name || 'Deckhand', index);
  state.players[seated.id] = seated;
  bodies.set(seated.id, createBody(seated.x, seated.y, seated.z));
  inputs.set(seated.id, emptyInput());
  return { id: seated.id, snapshot: snapshot() };
};

// A page that is simply closed never gets to say goodbye, so the host
// also watches for silence (below) and the joiner for a missing state.
const lastHeard = new Map(); // host: player id -> when their last input came
let lastStateAt = 0; // joiner: when the host last said anything

net.onInput = (id, input) => {
  inputs.set(id, { ...emptyInput(), ...input });
  lastHeard.set(id, performance.now());
};

net.onLeave = (id) => dropPlayer(id);

function dropPlayer(id) {
  game.removePlayer(id, bodies.get(id));
  bodies.delete(id);
  inputs.delete(id);
  lastHeard.delete(id);
  net.drop(id);
}

// --- a joiner's side -------------------------------------------------

net.onState = (incoming) => {
  lastStateAt = performance.now();
  applySnapshot(incoming);
  crew.sync(state.players, local.id);
  for (const other of Object.values(state.players)) {
    if (other.id !== local.id) crew.setTarget(other);
  }
  const me = state.players[local.id];
  if (!me) return;
  player.body.atWheel = me.atWheel;
  player.correct(me.x, me.y, me.z, RULES.correction);
  showScreen(state.phase === 'flight' ? 'flight' : 'lobby');
};

net.onLost = () => leaveShip('The ship went out of range');

// --- menu ------------------------------------------------------------

initMenu({
  onHost: () => hostGame(),
  onJoin: (code) => joinGame(code),
});

async function hostGame() {
  note('Opening a room...');
  local.name = playerName();
  local.isHost = true;
  local.id = 'host';
  state.players = {};
  bodies.clear();
  inputs.clear();

  let opened = false;
  for (let tries = 0; tries < 4 && !opened; tries++) {
    const code = makeCode();
    try {
      await net.host(code);
      local.code = code;
      state.code = code; // painted on the board at the dock
      opened = true;
    } catch (err) {
      if (err.message !== 'taken') {
        note('Could not open a room. Check your connection.');
        return;
      }
    }
  }
  if (!opened) {
    note('Every room code was taken. Try again.');
    return;
  }

  const me = newPlayer(local.id, local.name, 0);
  state.players[me.id] = me;
  bodies.set(me.id, player.body);
  inputs.set(me.id, emptyInput());
  lastHeard.clear();
  note('');
  boardShip(me);
}

async function joinGame(code) {
  joinError.hidden = true;
  local.name = playerName();
  local.isHost = false;
  try {
    const welcome = await net.join(code, local.name);
    local.id = welcome.id;
    local.code = code;
    applySnapshot(welcome.s);
    lastStateAt = performance.now();
    boardShip(state.players[local.id]);
  } catch (err) {
    net.close();
    joinError.textContent = err.message;
    joinError.hidden = false;
  }
}

function boardShip(me) {
  player.enter(me.x, me.y, me.z, me.yaw);
  crew.sync(state.players, local.id);
  lockOverlay.hidden = false;
  playUi.hidden = false;
  showScreen(state.phase === 'flight' ? 'flight' : 'lobby');
}

function leaveShip(message = '') {
  player.controls.unlock();
  net.close();
  state.players = {};
  bodies.clear();
  inputs.clear();
  lastHeard.clear();
  crew.sync({}, local.id);
  state.kit.heldBy = null;
  state.phase = 'lobby';
  state.countdown = null;
  playUi.hidden = true;
  player.exit(scene);
  note(message);
  showScreen('menu');
}

function note(message) {
  menuNote.textContent = message;
  menuNote.hidden = !message;
}

player.controls.addEventListener('lock', () => (lockOverlay.hidden = true));
player.controls.addEventListener('unlock', () => {
  if (inWorld()) lockOverlay.hidden = false;
});
document.getElementById('clickToPlay').addEventListener('click', () => player.controls.lock());
document.getElementById('leaveShip').addEventListener('click', () => leaveShip());

// --- the loop --------------------------------------------------------

// One input is built every frame but only sent 30 times a second, so a
// tap or a drop made in between has to wait in here rather than vanish.
let pending = emptyInput();
function queue(input) {
  pending.keys = input.keys;
  pending.yaw = input.yaw;
  pending.pitch = input.pitch;
  pending.use = input.use;
  pending.useTap = pending.useTap || input.useTap;
  pending.drop = pending.drop || input.drop;
  if (input.role !== null) pending.role = input.role;
}

function hostTick(dt, now) {
  for (const id of Object.keys(state.players)) {
    if (id === local.id) continue;
    const heard = lastHeard.get(id) ?? now;
    if (now - heard > RULES.timeoutMs) dropPlayer(id);
  }

  for (const seated of Object.values(state.players)) {
    const body = bodies.get(seated.id);
    const input = inputs.get(seated.id);
    if (!body || !input) continue;

    body.atWheel = seated.atWheel;
    stepBody(body, input, collidersFor(seated.role), dt, groundAt);
    seated.x = body.position.x;
    seated.y = body.position.y;
    seated.z = body.position.z;
    seated.yaw = input.yaw ?? seated.yaw;

    if (seated.atWheel) game.steerShip(dt, input.keys ?? {});
    if (input.drop) {
      game.dropKit(seated, body, input.yaw ?? 0);
      input.drop = false;
    }
  }

  game.tickLobby(dt);
  if (state.phase === 'flight' && currentScreen() !== 'flight') showScreen('flight');

  hostInteractions.update(dt, state.players, bodies, inputs, {
    mayUse: game.mayUse,
    run: (interact, seated, body) => game.ACTIONS[interact.action]?.(interact, seated, body),
  });

  player.syncView(); // the host's camera follows its own authoritative body
  crew.sync(state.players, local.id);
  for (const other of Object.values(state.players)) {
    if (other.id !== local.id) crew.setTarget(other);
  }
  net.broadcast(snapshot(), now);
}

// The kit lives wherever the state says: on the deck, in your hands, or
// in someone else's.
function updateKit() {
  const kit = world.kit;
  const heldBy = state.kit.heldBy;
  kit.userData.interact = heldBy ? null : KIT_INTERACT;

  if (!heldBy) {
    if (kit.parent !== ship) ship.add(kit);
    kit.position.set(state.kit.x, state.kit.y, state.kit.z);
    kit.rotation.set(0, 0, 0);
    return;
  }
  if (heldBy === local.id) {
    if (kit.parent !== camera) camera.add(kit);
    kit.position.set(0.48, -0.4, -1);
    kit.rotation.set(0, 0.5, 0);
    return;
  }
  const carrier = crew.meshFor(heldBy);
  if (carrier && kit.parent !== carrier) carrier.add(kit);
  if (carrier) {
    kit.position.set(0, 0.15, -0.5);
    kit.rotation.set(0, 0, 0);
  }
}

// What the dock is waiting for, in one line.
function updateBanner() {
  if (state.phase !== 'lobby') {
    banner.textContent = '';
    return;
  }
  const me = state.players[local.id];
  const crewList = Object.values(state.players);
  if (!me) return;

  if (me.role === 'crew') {
    const atRamp = Math.abs(me.x) < 2.5 && me.z > -6.5 && me.z < -2.5;
    banner.textContent = atRamp ? 'Grab a uniform first' : 'Take a uniform from a locker';
    return;
  }
  if (crewList.length < RULES.maxPlayers) {
    banner.textContent = `Waiting for the crew (${crewList.length}/${RULES.maxPlayers})`;
    return;
  }
  if (state.countdown === null) {
    banner.textContent = crewList.some((p) => p.role === 'crew')
      ? 'Waiting for everyone to dress'
      : 'All aboard: up the gangplank';
    return;
  }
  banner.textContent = `Casting off in ${Math.ceil(state.countdown)}`;
}

function updateStatus() {
  const me = state.players[local.id];
  if (!me) return;
  const role = me.role === 'crew' ? 'No uniform' : me.role[0].toUpperCase() + me.role.slice(1);
  const names = Object.values(state.players)
    .map((p) => (p.id === local.id ? `${p.name} (you)` : p.name))
    .join(', ');
  // Power and the rudder only mean something once the ship is flying.
  const parts = [
    `Room ${local.code}${local.isHost ? ' (host)' : ''}`,
    state.phase === 'flight'
      ? `${role} · power ${state.power.join('-')} · helm ${state.steering.toFixed(2)}`
      : role,
    `Crew: ${names}`,
  ];
  statusLine.textContent = parts.join('\n');
}

// Behind the menu: the ship turns slowly, seen from outside and from above,
// far enough back that the hull reads around the menu panel.
function orbitShip(t) {
  const angle = t * 0.08;
  camera.position.set(Math.cos(angle) * 32, 9, Math.sin(angle) * 32);
  camera.lookAt(0, 2, 0);
  // Turn away a little so the ship sits beside the menu panel, not behind it.
  camera.rotation.y += 0.42;
}

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1); // a backgrounded tab must not teleport anyone
  const t = clock.elapsedTime;
  const now = performance.now();

  // The ship rocks in the storm, but not while it is moored.
  const rocking = state.phase === 'flight' ? 1 : 0;
  ship.rotation.z = Math.sin(t * 0.8) * 0.06 * rocking;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03 * rocking;

  if (inWorld()) {
    const input = player.readInput();
    if (local.isHost) {
      // The host plays through the same pipe as everyone else.
      const own = inputs.get(local.id);
      if (own) {
        Object.assign(own, input, {
          useTap: own.useTap || input.useTap,
          drop: own.drop || input.drop,
          role: input.role ?? own.role,
        });
      }
      hostTick(dt, now);
    } else if (now - lastStateAt > RULES.timeoutMs) {
      leaveShip('The ship went out of range');
    } else {
      player.body.atWheel = state.players[local.id]?.atWheel ?? false;
      player.predict(input, dt, collidersFor(state.players[local.id]?.role ?? 'crew'), groundAt);
      queue(input);
      if (net.sendInput(pending, now)) {
        pending.useTap = false;
        pending.drop = false;
        pending.role = null;
      }
    }
    crew.update(dt);
    view.update(dt);
    updateStatus();
    updateBanner();
  } else {
    orbitShip(t);
  }

  // Every browser draws the scene from the state it has.
  applyState(world, state, state.players[local.id]?.atWheel ?? false);
  updateKit();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// Dev-only handle for driving the game from the console or a test script.
if (import.meta.env.DEV) {
  window.patch = {
    scene, camera, ship, world, player, crew, view,
    state, local, net, game, bodies, inputs, THREE,
  };
}

showScreen('menu');
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
