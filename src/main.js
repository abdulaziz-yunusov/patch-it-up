// Creates the renderer and camera, runs the loop, switches screens, and
// joins the two halves of a session: the host simulating, everyone drawing.

import * as THREE from 'three';
import { buildShip, addLights, addSky, applyRolePalette, applyState, groundHeight, hatchShut, takeoffProgress } from './world.js';
import { loadDockModel, updateDock, resetDockEffects } from './dock.js';
import { loadHelmModel, updateHelm, resetHelmEffects } from './helm.js';
import { loadPowerModel, updatePower, resetPowerEffects } from './power.js';
import { loadEngineModel, updateEngineRoom, resetEngineEffects } from './engine.js';
import { LocalPlayer, ROLE_COLORS, RemoteCrew, createBody, stepBody } from './player.js';
import { InteractionView, HostInteractions } from './interact.js';
import { Net, makeCode } from './network.js';
import { play } from './sound.js';
import {
  RULES,
  ROUTES,
  SPAWNS,
  SPAWN_YAW,
  applySnapshot,
  local,
  newPlayer,
  playerCount,
  snapshot,
  state,
} from './state.js';
import * as game from './game.js';
import { showScreen, currentScreen } from './screens.js';
import { initMenu, playerName, refreshNameChip } from './menu.js';
import { initGathering, resetGathering, updateGathering } from './gathering.js';
import { initJoin, joinFailed, joinSucceeded, openJoin } from './join.js';
import { load, save } from './save.js';
import { keyLabel, moveLabel, onSettingsChange, settings } from './settings.js';
import { closeSettings, initSettings, isSettingsOpen, openSettings } from './settingsScreen.js';
import { PALETTES, fillRoleKey, inkFor } from './roleLook.js';
import { createRain } from './rain.js';
import { resetSubtitles, updateSubtitles } from './subtitles.js';

// Graphics quality is the resolution the scene is drawn at: below the
// screen's own on Low, up to a sharp screen's full detail on High.
function pixelRatio(quality) {
  const screen = window.devicePixelRatio || 1;
  if (quality === 'low') return Math.min(screen, 1) * 0.7;
  if (quality === 'high') return Math.min(screen, 2);
  return Math.min(screen, 1.25);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio(settings.quality));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
addSky(scene);
addLights(scene);

const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 400);
// PointerLockControls turns the camera as yaw then pitch; reading the angles
// back only gives that pair if the euler is decomposed in the same order.
camera.rotation.order = 'YXZ';

const world = buildShip();
const ship = world.ship;
scene.add(ship);
loadDockModel(world); // swaps the coded dock for the Blender one when it arrives
loadHelmModel(world); // furnishes the pilot's cabin
loadPowerModel(world); // furnishes the engineer's power room
loadEngineModel(world); // furnishes the mechanic's engine room

const player = new LocalPlayer({ ship, camera, colliders: world.colliders });
const crew = new RemoteCrew(ship, RULES.stateHz);
const view = new InteractionView({
  ship,
  camera,
  player,
  me: () => state.players[local.id],
  canUse: game.canUse,
});

const net = new Net();
const hostInteractions = new HostInteractions(ship);
const bodies = new Map(); // host only: player id -> body it simulates
const inputs = new Map(); // host only: player id -> the input last heard

const playUi = document.getElementById('play');
const timerText = document.getElementById('timer');
const altitudeFill = document.getElementById('altitudeFill');
const altitudeText = document.getElementById('altitudeText');
const furnaceFill = document.getElementById('furnaceFill');
const furnaceText = document.getElementById('furnaceText');
const takeoffTitle = document.getElementById('takeoffTitle');
const takeoffJob = document.getElementById('takeoffJob');
const flash = document.getElementById('flash');
const resultTitle = document.getElementById('resultTitle');
const resultDetail = document.getElementById('resultDetail');
const lockOverlay = document.getElementById('lockOverlay');
const statusLine = document.getElementById('status');
const banner = document.getElementById('banner');
const menuNote = document.getElementById('menuNote');
const KIT_INTERACT = world.kit.userData.interact;

// True from the moment you host or join until you are back at the menu;
// the phase (gathering, lobby, takeoff, flight, result) says which screen
// to show. inWorld: this browser has stepped onto the dock (it does not
// on the crew screen, where there is nothing to walk around).
let sessionActive = false;
let inWorld = false;
let againRequested = false;
let seenOpened = 0; // to flash when a new hole tears
let flashUntil = 0;

// Where the floor is, and what blocks you, both depend on the phase: at
// the dock there is a platform, a gangplank and an open cargo door.
const groundAt = (x, z) => groundHeight(x, z, state.phase);
function collidersFor(role) {
  if (state.phase !== 'lobby') return world.flightColliders; // hatch shut, dock gone
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
  bell: false,
  callout: false,
  again: false,
});

// --- the host's side of a session ------------------------------------

net.onHello = (name) => {
  if (playerCount() >= RULES.maxPlayers) return null; // "Ship is full"
  // The first free seat: p1 leaving and someone new arriving must not
  // hand out a second p2.
  let index = 1;
  while (state.players[`p${index}`]) index += 1;
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
};

net.onLost = () => leaveShip('The ship went out of range');

// --- menu ------------------------------------------------------------

initMenu({
  onHost: () => hostGame(),
  onJoin: () => openJoin(),
  onSettings: () => openSettings(),
});

initJoin({
  onJoin: (code) => joinGame(code),
  onCancel: () => {
    joinAttempt += 1; // whatever that connection does next, nobody is waiting for it
    net.close();
  },
  onLeave: () => {
    refreshNameChip();
    showScreen('menu');
  },
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
  // The crew screen first: the code to read out, and who has joined.
  state.phase = 'gathering';
  state.countdown = null;
  startSession();
}

// Each try gets a number; a cancelled one that answers late is ignored.
let joinAttempt = 0;

async function joinGame(code) {
  const attempt = ++joinAttempt;
  local.name = playerName();
  local.isHost = false;
  try {
    const welcome = await net.join(code, local.name);
    if (attempt !== joinAttempt) return;
    local.id = welcome.id;
    local.code = code;
    applySnapshot(welcome.s);
    lastStateAt = performance.now();
    joinSucceeded(code, state.players.host?.name ?? 'The host');
    startSession();
  } catch (err) {
    if (attempt !== joinAttempt) return;
    net.close();
    joinFailed(err.message, code);
  }
}

function startSession() {
  sessionActive = true;
  inWorld = false;
  seenOpened = state.opened;
  syncPhaseUi();
}

// Off the crew screen and onto the dock (or wherever the ship is, for
// someone who joins late): the camera goes to your own eyes.
function enterWorld() {
  const me = state.players[local.id];
  if (!me) return;
  inWorld = true;
  player.enter(me.x, me.y, me.z, me.yaw);
  crew.sync(state.players, local.id);
  lockOverlay.hidden = false;
}

// One screen per phase, and the result panel needs the mouse back.
function syncPhaseUi() {
  if (currentScreen() !== state.phase) showScreen(state.phase);
  const gathering = state.phase === 'gathering';
  if (!gathering && !inWorld) enterWorld();
  const playing = state.phase !== 'result' && !gathering;
  playUi.hidden = !playing;
  if (state.phase === 'result') {
    if (player.controls.isLocked) player.controls.unlock();
    resultTitle.textContent = state.result === 'landed' ? 'Landed!' : 'The ship went down';
    const holes = state.patched === 1 ? '1 breach' : `${state.patched} breaches`;
    resultDetail.textContent =
      state.result === 'landed'
        ? `Three minutes in the air, ${holes} patched.`
        : `${holes} patched before the altitude ran out.`;
  }
}

function leaveShip(message = '') {
  sessionActive = false;
  inWorld = false;
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
  resetDockEffects();
  resetHelmEffects();
  resetPowerEffects();
  resetEngineEffects();
  resetGathering();
  resetSubtitles();
  seenCallout = null;
  calloutBox.hidden = true;
  if (isSettingsOpen()) closeSettings();
  refreshNameChip();
  note(message);
  showScreen('menu');
}

initGathering({
  onBack: () => leaveShip(),
  onGo: () => game.goToDock(),
  // The host renames themselves on the crew screen; joiners already have it.
  onRename: (name) => {
    save({ ...load(), name });
    local.name = playerName();
    const me = state.players[local.id];
    if (me) me.name = local.name;
  },
});

function note(message) {
  menuNote.textContent = message;
  menuNote.hidden = !message;
}

player.controls.addEventListener('lock', () => (lockOverlay.hidden = true));
player.controls.addEventListener('unlock', () => {
  if (sessionActive && state.phase !== 'result') lockOverlay.hidden = false;
});
document.getElementById('clickToPlay').addEventListener('click', () => player.controls.lock());
// Settings mid-game: the game goes on underneath (it is online), and
// "Click to play" is waiting when the page closes.
document.getElementById('openSettings').addEventListener('click', () => openSettings());
document.getElementById('leaveShip').addEventListener('click', () => leaveShip());
document.getElementById('resultBack').addEventListener('click', () => {
  if (!sessionActive) {
    showScreen('menu');
    return;
  }
  // The host decides; a joiner asks with its next input.
  if (local.isHost) returnToDock();
  else againRequested = true;
});

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
  pending.bell = pending.bell || input.bell;
  pending.callout = pending.callout || input.callout;
  pending.again = pending.again || input.again;
}

function hostTick(dt, now) {
  for (const id of Object.keys(state.players)) {
    if (id === local.id) continue;
    const heard = lastHeard.get(id) ?? now;
    if (now - heard > RULES.timeoutMs) dropPlayer(id);
    else state.players[id].signal = now - heard > RULES.weakSignalMs ? 'weak' : 'good';
  }

  // On the crew screen nobody walks or works a station: the keys being
  // pressed are a name being typed. The state still goes out, so joiners
  // see the crew list fill up.
  if (state.phase === 'gathering') {
    net.broadcast(snapshot(), now);
    return;
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
    // The pilot's bell key rings the cabin bell from anywhere aboard.
    if (input.bell) {
      input.bell = false;
      if (seated.role === 'pilot') game.ringCabinBell();
    }
    if (input.callout) {
      input.callout = false;
      game.callOut(seated);
    }
    if (input.again) {
      input.again = false;
      returnToDock();
    }
  }

  if (state.phase === 'lobby') game.tickLobby(dt);
  else if (state.phase === 'takeoff') game.tickTakeoff(dt);
  else if (state.phase === 'flight') game.tickFlight(dt);

  hostInteractions.update(dt, state.players, bodies, inputs, {
    canUse: game.canUse,
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
// The host sends everyone back down the gangplank for another round.
function returnToDock() {
  if (!game.backToDock()) return;
  Object.values(state.players).forEach((seated, index) => {
    const spawn = SPAWNS[index % SPAWNS.length];
    seated.x = spawn.x;
    seated.y = spawn.y;
    seated.z = spawn.z;
    const body = bodies.get(seated.id);
    if (body) {
      body.position.set(spawn.x, spawn.y, spawn.z);
      body.velocityY = 0;
      body.atWheel = false;
    }
    if (seated.id === local.id) player.enter(spawn.x, spawn.y, spawn.z, SPAWN_YAW);
  });
}

// Timer, altitude bar and which way it is heading, the furnace, and a
// red wash the moment a new hole tears.
function updateRoundHud(now) {
  const minutes = Math.floor(state.timeLeft / 60);
  const seconds = Math.floor(state.timeLeft % 60);
  timerText.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const altitude = Math.max(0, Math.round(state.altitude));
  altitudeFill.style.width = `${altitude}%`;
  altitudeFill.classList.toggle('low', altitude <= 30);
  const trend = state.climb > 0.05 ? ' ▲' : state.climb < -0.05 ? ' ▼' : '';
  altitudeText.textContent = `Altitude ${altitude}%${trend}`;

  const heat = Math.round(state.heat * 100);
  furnaceFill.style.width = `${heat}%`;
  furnaceFill.classList.toggle('low', heat <= 25);
  furnaceText.textContent = state.spare > 0
    ? `Furnace ${heat}% · ${state.spare} spare power`
    : `Furnace ${heat}%`;

  if (state.opened > seenOpened) {
    seenOpened = state.opened;
    flashUntil = now + 500;
  }
  flash.style.opacity = flashUntil > now ? ((flashUntil - now) / 500) * 0.9 : 0;
}

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

// What each role is for, read out while the ship climbs, with the keys
// the player has actually bound.
const JOBS = {
  mechanic: () =>
    `Mechanic: patch the breaches (hold ${keyLabel(settings.keys.interact)}) and keep the furnace stoked. A cold furnace means no power.`,
  engineer: () => 'Engineer: pull the levers to share power. Lift holds her up, engines steer, shields stop rocks.',
  pilot: () =>
    `Pilot: take the wheel and steer round the rocks. Starved engines make her slow to answer. ${keyLabel(settings.keys.bell)} rings the bell.`,
};

// The climb: what is happening, then your job, then a last call.
let seenPhase = null;
let seenHatch = false;
function updateTakeoff() {
  const phase = state.phase;
  if (phase === 'takeoff' && seenPhase === 'lobby') play('engineer_steam_hiss', 0.6); // moorings off
  seenPhase = phase;
  const shut = hatchShut(state);
  if (shut && !seenHatch && phase === 'takeoff') play('engineer_lever_clunk', 0.8); // the hatch slams
  seenHatch = shut;
  if (phase !== 'takeoff') return;

  takeoffTitle.textContent =
    state.takeoff < 1.5 ? 'Casting off!' : !hatchShut(state) ? 'Climbing to cruising height' : 'Hatch shut. Brace yourselves!';
  const role = state.players[local.id]?.role;
  takeoffJob.textContent = JOBS[role]?.() ?? '';
}

// The ship panel: each tube's units, how hot it runs, a blown fuse; the
// power budget and what is draining it; the mechanic's planks and fuses.
const tubeRows = [...document.querySelectorAll('#shipPanel .tube-row')].map((row) => ({
  row,
  pips: [...row.querySelectorAll('.pips i')],
  heat: row.querySelector('.heat span'),
  fuse: row.querySelector('.fuse-tag'),
}));
const budgetText = document.getElementById('budgetText');
const budgetNote = document.getElementById('budgetNote');
const plankText = document.getElementById('plankText');
const fuseText = document.getElementById('fuseText');

function updateShipPanel() {
  tubeRows.forEach(({ row, pips, heat, fuse }, i) => {
    const blown = !!state.blown[i];
    const hot = state.tubeHeat[i] / RULES.overheatSeconds;
    pips.forEach((pip, k) => pip.classList.toggle('on', k < state.power[i]));
    heat.style.width = `${Math.round(Math.min(1, hot) * 100)}%`;
    row.classList.toggle('hot', !blown && state.tubeHeat[i] >= RULES.overheatWarn);
    row.classList.toggle('blown', blown);
    fuse.hidden = !blown;
  });
  const total = state.spare + state.power.reduce((a, b) => a + b, 0);
  budgetText.textContent = `Budget ${total}`;
  budgetNote.textContent = state.drain
    ? `−${state.drain} from breaches`
    : state.spare
      ? `${state.spare} spare`
      : 'All used';
  budgetNote.classList.toggle('bad', state.drain > 0);
  const planks = state.kit.planks ?? 0;
  plankText.textContent = `Kit ${planks} plank${planks === 1 ? '' : 's'}`;
  plankText.classList.toggle('bad', planks === 0);
  fuseText.textContent = `Fuses ${state.fuses}`;
  fuseText.classList.toggle('bad', state.fuses === 0);
}

// A call-out: the caller's name and words in their role colour, with the
// speaking-tube echo, for everyone aboard.
const calloutBox = document.getElementById('callout');
const calloutWho = document.getElementById('calloutWho');
const calloutWords = document.getElementById('calloutText');
let seenCallout = null;
let calloutUntil = 0;
function updateCallout(now) {
  const call = state.callout;
  if (seenCallout === null) seenCallout = call.count; // joining late: no old news
  if (call.count !== seenCallout) {
    seenCallout = call.count;
    calloutUntil = now + 3500;
    calloutWho.textContent = call.id === local.id ? 'You called' : `${call.name} called`;
    calloutWords.textContent = call.text;
    const color = ROLE_COLORS[call.role] ?? ROLE_COLORS.crew;
    calloutBox.style.background = color;
    calloutBox.style.color = inkFor(color);
    play('comms_speaking_tube_echo', 0.55);
  }
  calloutBox.hidden = now > calloutUntil;
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
  const holding = me.fuse
    ? 'a spare fuse'
    : state.kit.heldBy === me.id
      ? `the patch kit (${state.kit.planks} plank${state.kit.planks === 1 ? '' : 's'})`
      : 'nothing';
  const names = Object.values(state.players)
    .map((p) => (p.id === local.id ? `${p.name} (you)` : p.name))
    .join(', ');
  // Power and the rudder only mean something once the ship is flying.
  const parts = [
    `Room ${local.code}${local.isHost ? ' (host)' : ''}`,
    state.phase === 'flight'
      ? `${role} · holding ${holding}`
      : `${role} · ${ROUTES[state.route].name}`,
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

  // The ship rocks in the storm, but not while it is moored. On the way
  // up the storm builds, the bow lifts, and the deck shudders as she
  // tears free of the moorings.
  const climbed = takeoffProgress(state);
  const motion = settings.cameraShake ? settings.cameraMotion / 100 : 0;
  const rocking = (state.phase === 'result' ? 0 : climbed) * motion;
  const noseUp = state.phase === 'takeoff' ? Math.sin(climbed * Math.PI) * 0.05 * motion : 0;
  const lurch = state.phase === 'takeoff' ? Math.max(0, 1 - state.takeoff / 1.2) * Math.sin(t * 40) * 0.012 * motion : 0;
  ship.rotation.z = Math.sin(t * 0.8) * 0.06 * rocking + noseUp + lurch;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03 * rocking;

  if (sessionActive && state.phase === 'gathering') {
    syncPhaseUi();
    player.readInput(); // keys typed on this screen are not for walking
    if (local.isHost) hostTick(dt, now);
    else if (now - lastStateAt > RULES.timeoutMs) leaveShip('The ship went out of range');
    else net.sendInput(emptyInput(), now); // still here, so the host keeps our seat
    if (state.phase === 'gathering') updateGathering(state, local, now);
    orbitShip(t);
  } else if (sessionActive) {
    syncPhaseUi();
    const input = player.readInput();
    input.again = againRequested;
    againRequested = false;
    if (local.isHost) {
      // The host plays through the same pipe as everyone else.
      const own = inputs.get(local.id);
      if (own) {
        Object.assign(own, input, {
          useTap: own.useTap || input.useTap,
          drop: own.drop || input.drop,
          bell: own.bell || input.bell,
          callout: own.callout || input.callout,
          again: own.again || input.again,
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
        pending.bell = false;
        pending.callout = false;
        pending.again = false;
      }
    }
    crew.update(dt);
    view.update(dt);
    updateStatus();
    updateBanner();
    updateRoundHud(now);
    updateTakeoff();
    updateSubtitles(state, now, settings.subtitles, subtitleLine);
    updateCallout(now);
    if (state.phase === 'flight') updateShipPanel();
  } else {
    orbitShip(t);
  }

  // Every browser draws the scene from the state it has.
  applyState(world, state, state.players[local.id]?.atWheel ?? false);
  updateKit();
  updateDock(world, state, local, now);
  updateHelm(world, state, { camera, view, player, now, dt });
  updatePower(world, state, { now, dt });
  updateEngineRoom(world, state, { now, dt });
  const airborne = state.phase === 'takeoff' || state.phase === 'flight';
  rain.update(dt, settings.rain && sessionActive && inWorld && airborne);
  // The Blender dock swaps in its own lockers once it loads: paint those too.
  if (world.lockers !== paintedLockers) paintRoles();
  countFrame(now);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// --- settings ----------------------------------------------------------

const subtitleLine = document.getElementById('subtitle');
const fpsBox = document.getElementById('fps');
const rain = createRain(ship);
const TEXT_SCALE = { normal: 1, large: 1.25, xlarge: 1.5 };
let paintedLockers = null;

// Role colours everywhere they show: teammates, lockers, room stripes,
// the menu's key; symbols beside them when that is on.
function paintRoles() {
  const palette = PALETTES[settings.colorblind] ?? PALETTES.off;
  Object.assign(ROLE_COLORS, palette);
  applyRolePalette(world, palette, settings.colorblind === 'off');
  paintedLockers = world.lockers;
  for (const key of document.querySelectorAll('.role-key')) fillRoleKey(key, palette, settings.roleSymbols);
  crew.sync(state.players, local.id); // recolours and re-badges the spheres now
}

// The HUD's key hints say whatever the player has bound.
function showKeyHints() {
  for (const el of document.querySelectorAll('[data-key]')) {
    el.textContent = el.dataset.key === 'move' ? moveLabel() : keyLabel(settings.keys[el.dataset.key]);
  }
}

function applySettings(key) {
  const all = key === null;
  if (all || key === 'fov') {
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
  }
  if (all || key === 'quality') {
    renderer.setPixelRatio(pixelRatio(settings.quality));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  if (all || key === 'textSize') {
    document.documentElement.style.setProperty('--hud-scale', String(TEXT_SCALE[settings.textSize] ?? 1));
  }
  if (all || key === 'colorblind' || key === 'roleSymbols') paintRoles();
  if (all || key === 'keys') showKeyHints();
  if (all || key === 'showFps') fpsBox.hidden = !settings.showFps;
}

// Frames per second, counted over half a second at a time.
let frames = 0;
let framesSince = performance.now();
function countFrame(now) {
  if (!settings.showFps) return;
  frames += 1;
  if (now - framesSince >= 500) {
    fpsBox.textContent = `${Math.round((frames * 1000) / (now - framesSince))} FPS`;
    frames = 0;
    framesSince = now;
  }
}

initSettings();
onSettingsChange(applySettings);
applySettings(null);

// Dev-only handle for driving the game from the console or a test script.
if (import.meta.env.DEV) {
  window.patch = {
    scene, camera, ship, world, player, crew, view,
    state, local, net, game, bodies, inputs, RULES, THREE, hostInteractions, renderer,
  };
}

showScreen('menu');
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
