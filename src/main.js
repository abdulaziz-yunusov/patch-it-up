// Creates the renderer and camera, runs the loop, switches screens, and
// joins the two halves of a session: the host simulating, everyone drawing.

import * as THREE from 'three';
import { DRIFT_METRES, HELM_STANCE, SHIP, buildShip, addLights, addSky, applyRolePalette, applyState, groundHeight, hatchShut, takeoffProgress, updateHazards } from './world.js';
import { loadDockModel, updateDock, resetDockEffects } from './dock.js';
import { buildHarbour, updateHarbour } from './harbour.js';
import { loadHelmModel, updateHelm, resetHelmEffects } from './helm.js';
import { loadPowerModel, updatePower, resetPowerEffects } from './power.js';
import { loadEngineModel, updateEngineRoom, resetEngineEffects } from './engine.js';
import { LocalPlayer, PLAYER, ROLE_COLORS, RemoteCrew, createBody, setHat, stepBody } from './player.js';
import { loadCharacter, loadCrewRoles } from './character.js';
import { InteractionView, HostInteractions } from './interact.js';
import { Net, makeCode } from './network.js';
import { startPulse } from './pulse.js';
import { play } from './sound.js';
import {
  ROLES,
  RULES,
  ROUTES,
  SPAWNS,
  SPAWN_YAW,
  applySnapshot,
  livePower,
  local,
  newPlayer,
  playerCount,
  roleTaken,
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
import { FALL as RAIN_FALL, createRain } from './rain.js';
import { buildPirates, lastPirateHit, resetPirateEffects, updatePirates } from './pirates.js';
import { totalStars } from './log.js';
import { showResult } from './results.js';
import { duckMusic, musicState, setMood, sting, updateMusic } from './music.js';
import { resetSubtitles, updateSubtitles } from './subtitles.js';
import { voiceDelays, endVoice, handleSignal, hostLink, hostUnlink, initVoice, micState, startMic, stopMic, voiceStatus } from './voice.js';
import { hasVoice, isSpeaking, outputRoute, placeVoices } from './audio.js';
import { initVoiceUi, updateVoiceUi } from './voiceUi.js';
import { clearJobList, coveredRoles, jobsFor, updateJobList } from './jobs.js';
import { TRAINING_START, skipLesson, startTraining, stopTraining, trainingActive, trainingFinished, updateTraining } from './training.js';

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
// A gentle tone curve keeps sunlit colours rich instead of blown out.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
addSky(scene);
const lights = addLights(scene);

// Shadows by quality: none on Low, sharper on High.
function applyShadowQuality() {
  const on = settings.quality !== 'low';
  renderer.shadowMap.enabled = on;
  const size = settings.quality === 'high' ? 4096 : 2048;
  const shadow = lights.harbourSun.shadow;
  if (shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
  scene.traverse((o) => o.material && (o.material.needsUpdate = true));
}
applyShadowQuality();

const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 800);
// PointerLockControls turns the camera as yaw then pitch; reading the angles
// back only gives that pair if the euler is decomposed in the same order.
camera.rotation.order = 'YXZ';

const world = buildShip();
const ship = world.ship;
scene.add(ship);
// The Blender dock replaces the coded one when it arrives, and the harbour
// (island, scenery, sky) is built round it.
loadDockModel(world).then((ok) => {
  buildHarbour(world, scene, ok ? world.dock.getObjectByName('waitingRoom') : null);
  // Get every new material ready now, not with a stutter on first sight.
  renderer.compileAsync?.(scene, camera).catch(() => {});
});
loadHelmModel(world); // furnishes the pilot's cabin
loadPowerModel(world); // furnishes the engineer's power room
loadEngineModel(world); // furnishes the mechanic's engine room
buildPirates(world); // the sky pirates' ship, crew, grapples and boarders

const player = new LocalPlayer({ ship, camera, colliders: world.colliders });
const crew = new RemoteCrew(ship, RULES.stateHz);
// The crew characters (Blender, public/models): until both files load,
// players are spheres; then everyone swaps to a deckhand, and to the
// pilot's, mechanic's or engineer's outfit once that uniform is taken.
Promise.all([loadCharacter(), loadCrewRoles()]).then(([gltf]) => {
  if (gltf) crew.rebuild();
});
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
const helmGauge = document.getElementById('helmGauge');
const helmShip = document.getElementById('helmShip');
const helmRock = document.getElementById('helmRock');
const resultBack = document.getElementById('resultBack');
const resultAgain = document.getElementById('resultAgain');
const endingScreen = document.getElementById('ending');
const endingTitle = document.getElementById('endingTitle');
const endingLine = document.getElementById('endingLine');
const lockOverlay = document.getElementById('lockOverlay');
const statusLine = document.getElementById('status');
const banner = document.getElementById('banner');
const menuNote = document.getElementById('menuNote');
const netNote = document.getElementById('netNote');
const KIT_INTERACT = world.kit.userData.interact;

// True from the moment you host or join until you are back at the menu;
// the phase (gathering, lobby, takeoff, flight, ending, result) says which screen
// to show. inWorld: this browser has stepped onto the dock (it does not
// on the crew screen, where there is nothing to walk around).
let sessionActive = false;
let inWorld = false;
let flownFlight = -1; // the last flight this browser was aboard for: only that one goes in its log
let shownResult = -1; // the flight whose result screen is up
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
  wave: false,
  flyTap: false, // a double-tap of jump: take off, or land
});

// --- the host's side of a session ------------------------------------

// A page that is simply closed never gets to say goodbye, so the host
// also watches for silence (below) and the joiner for a missing state.
const lastHeard = new Map(); // host: player id -> when their last input came
const lostAt = new Map(); // host: player id -> when their line went dead
const seatTokens = new Map(); // host: player id -> the secret that gives that seat back
const acks = new Map(); // host: player id -> { seq, at } of the newest input heard
let lastStateAt = 0; // joiner: when the host last said anything

const cleanName = (name) => String(name ?? '').trim().slice(0, 12) || 'Deckhand';
const newToken = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');

net.onHello = (name, token) => {
  const now = performance.now();
  // Coming back after a dropped line: the same seat, uniform, place and
  // all, as long as the seat is still being held.
  const returning = token && [...seatTokens].find(([id, t]) => t === token && state.players[id])?.[0];
  if (returning) {
    const seated = state.players[returning];
    seated.signal = 'good';
    lostAt.delete(returning);
    lastHeard.set(returning, now);
    acks.delete(returning);
    inputs.set(returning, { ...emptyInput(), yaw: seated.yaw });
    return { id: returning, token, snapshot: snapshot() };
  }

  if (playerCount() >= RULES.maxPlayers) return null; // "Ship is full"
  // The first free seat: p1 leaving and someone new arriving must not
  // hand out a second p2.
  let index = 1;
  while (state.players[`p${index}`]) index += 1;
  const seated = newPlayer(`p${index}`, cleanName(name), index);
  // Late, with the dock already gone: in through the cargo door, wearing
  // whichever uniform nobody has (the lockers stayed on the dock).
  if (state.phase !== 'gathering' && state.phase !== 'lobby') {
    seated.x = 0;
    seated.y = PLAYER.radius;
    seated.z = -SHIP.width / 2 + 1;
    seated.role = ROLES.find((role) => !roleTaken(role)) ?? 'crew';
  }
  state.players[seated.id] = seated;
  bodies.set(seated.id, createBody(seated.x, seated.y, seated.z));
  inputs.set(seated.id, emptyInput());
  lastHeard.set(seated.id, now);
  const seatToken = newToken();
  seatTokens.set(seated.id, seatToken);
  return { id: seated.id, token: seatToken, snapshot: snapshot() };
};

// Only what an input may hold, whatever a browser sends. Presses (E, drop,
// the bell...) are kept until a host tick has used them: two packets
// landing in one frame must not lose the first one's tap.
const PRESSES = ['useTap', 'drop', 'bell', 'callout', 'wave', 'flyTap'];
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
net.onInput = (id, raw) => {
  if (!state.players[id] || !raw || typeof raw !== 'object') return;
  const previous = inputs.get(id) ?? emptyInput();
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  const input = {
    keys: {
      KeyW: !!keys.KeyW,
      KeyA: !!keys.KeyA,
      KeyS: !!keys.KeyS,
      KeyD: !!keys.KeyD,
      Space: !!keys.Space,
      Shift: !!keys.Shift,
    },
    yaw: finite(raw.yaw, previous.yaw),
    pitch: Math.max(-1.6, Math.min(1.6, finite(raw.pitch, 0))),
    use: !!raw.use,
  };
  for (const press of PRESSES) input[press] = !!previous[press] || !!raw[press];
  inputs.set(id, input);
  // Their microphone, for everyone's voice list: on, muted, or none.
  state.players[id].mic = ['on', 'muted', 'none'].includes(raw.mic) ? raw.mic : 'none';
  // The stars in their own log: the mirror offers the hats those open.
  state.players[id].stars = Math.max(0, Math.min(99, Math.floor(finite(raw.stars, 0))));
  const now = performance.now();
  lastHeard.set(id, now);
  if (Number.isFinite(raw.seq)) acks.set(id, { seq: raw.seq, at: now });
};

net.onLeave = (id) => dropPlayer(id);
net.onDrop = (id) => holdSeat(id);

// Gone for good: free what they held and give the seat up.
function dropPlayer(id) {
  game.removePlayer(id, bodies.get(id));
  bodies.delete(id);
  inputs.delete(id);
  lastHeard.delete(id);
  lostAt.delete(id);
  seatTokens.delete(id);
  acks.delete(id);
  hostInteractions.holds.delete(id);
  hostUnlink(id);
  net.release(id, { bye: true });
}

// A line gone quiet or dead: the seat waits a while for its player to
// reconnect, standing still meanwhile, before it is given up.
function holdSeat(id) {
  const seated = state.players[id];
  if (!seated || seated.signal === 'lost') return;
  seated.signal = 'lost';
  lostAt.set(id, performance.now());
  inputs.set(id, { ...emptyInput(), yaw: seated.yaw });
  // Their hands come off the wheel and they put down what they carry, so
  // the rest of the crew can steer and patch while the seat waits for them.
  game.letGo(seated, bodies.get(id));
  hostInteractions.holds.delete(id);
  hostUnlink(id);
  net.release(id);
}

// --- a joiner's side -------------------------------------------------

// The host's clock is not ours. The quickest packet so far gives the best
// guess at the difference; the guess creeps up slowly too, so a busier
// route later on does not leave it stuck.
let clockOffset = null;
function hostTimeToLocal(hostTime, now) {
  if (!Number.isFinite(hostTime)) return now;
  const offset = now - hostTime;
  clockOffset = clockOffset === null || offset < clockOffset ? offset : clockOffset + (offset - clockOffset) * 0.01;
  return hostTime + clockOffset;
}

// When each input went (seq -> our clock), so the host's answer to it can
// be held up against where we were then.
let inputSeq = 0;
const sentAt = new Map();

net.onState = (incoming, hostTime) => {
  if (!incoming || typeof incoming !== 'object') return;
  const now = performance.now();
  lastStateAt = now;
  const at = hostTimeToLocal(hostTime, now);
  applySnapshot(incoming);
  crew.sync(state.players, local.id);
  for (const other of Object.values(state.players)) {
    if (other.id !== local.id) crew.setTarget(other, at);
  }
  const me = state.players[local.id];
  if (!me || !inWorld) return;
  player.body.atWheel = me.atWheel;
  const sent = sentAt.get(me.ack);
  for (const seq of sentAt.keys()) {
    if (seq < me.ack) sentAt.delete(seq);
  }
  if (sent !== undefined) player.reconcile(me.x, me.y, me.z, sent + (me.ackAge ?? 0), RULES.correction);
  else player.correct(me.x, me.y, me.z, RULES.correction);
};

net.onLost = () => rejoin();
net.onClosed = () => leaveShip('The host closed the ship');

// Voice rides on the same links: the host adds audio to each joiner's as
// soon as they are seated (again, after a reconnect).
net.onSeated = (id, conn) => hostLink(id, conn);
net.onSignal = (msg, conn, id) => handleSignal(msg, conn, id);
initVoice({ send: (conn, msg) => net.post(conn, msg) });
initVoiceUi();

// The microphone is on while it can be used or tested: in a session, on
// the Join screen (its Voice check), and in the settings' Audio tab.
// Back on the main menu it goes off, and the browser's recording dot with it.
function syncMic() {
  // Training is solo: nobody to talk to, so the mic stays off (unless the
  // settings' Audio tab is testing it).
  if ((sessionActive && !trainingActive()) || opening || currentScreen() === 'join' || isSettingsOpen()) startMic();
  else stopMic();
}

// --- menu ------------------------------------------------------------

initMenu({
  onHost: () => hostGame(),
  onJoin: () => {
    openJoin();
    startMic();
  },
  onSettings: () => openSettings(syncMic),
  onTraining: () => beginTraining(),
});

// Training: a solo flight on this computer alone (no room is opened), the
// game in its gentle mode, and training.js leading the way. It reuses the
// host's whole machinery: this browser simulates the ship and plays it.
function beginTraining() {
  if (opening || sessionActive) return;
  note('');
  local.name = playerName();
  local.isHost = true;
  local.id = 'host';
  local.code = '';
  state.players = {};
  game.newSession();
  bodies.clear();
  inputs.clear();
  forgetSeats();
  crew.delay = 0;
  state.code = '';
  state.route = 0; // Calm Cliffs

  const me = newPlayer(local.id, local.name, 0);
  Object.assign(me, { x: TRAINING_START.x, y: TRAINING_START.y, z: TRAINING_START.z, yaw: TRAINING_START.yaw, role: 'mechanic' });
  state.players[me.id] = me;
  bodies.set(me.id, player.body);
  inputs.set(me.id, { ...emptyInput(), yaw: me.yaw });

  game.startRound();
  state.flight = 1;
  state.phase = 'flight';
  game.setTraining(true);
  startTraining({
    world,
    // The last lesson done: the mouse back for the buttons.
    finish: () => {
      lockOverlay.hidden = true;
      if (player.controls.isLocked) player.controls.unlock();
    },
  });
  startSession();
  showTrainingButtons();
}

// The job list: in flight, for the jobs this player covers. Training has
// its own card in that spot, so the list waits until a real flight.
function updateJobs(now) {
  const me = state.players[local.id];
  const show = state.phase === 'flight' && !trainingActive() && !!me;
  const key = (action) => keyLabel(settings.keys[action]);
  updateJobList(show ? jobsFor(state, me, key) : [], { show, roles: coveredRoles(state, me), now });
}

// The pause menu's buttons say what they do in training.
function showTrainingButtons() {
  const training = trainingActive();
  document.getElementById('skipLesson').hidden = !training;
  document.getElementById('leaveShip').textContent = training ? 'Leave training' : 'Leave ship';
}

initJoin({
  onJoin: (code) => joinGame(code),
  onCancel: () => {
    joinAttempt += 1; // whatever that connection does next, nobody is waiting for it
    net.close();
  },
  onLeave: () => {
    refreshNameChip();
    showScreen('menu');
    syncMic();
  },
});

// A second click while the first room is still opening must not open two.
let opening = false;
async function hostGame() {
  if (opening || sessionActive) return;
  opening = true;
  startMic(); // asked now, while the click still counts as the player's
  try {
    await openRoom();
  } finally {
    opening = false;
    syncMic(); // off again if no room opened
  }
}

async function openRoom() {
  note('Opening a room...');
  local.name = playerName();
  local.isHost = true;
  local.id = 'host';
  state.players = {};
  game.newSession(); // nothing of an earlier session (ours or another host's) carries over
  bodies.clear();
  inputs.clear();
  forgetSeats();
  crew.delay = 0; // the host simulates everyone: nothing to wait for

  let opened = false;
  let failure = '';
  for (let tries = 0, hiccups = 0; tries < 4 + hiccups && !opened; tries++) {
    const code = makeCode();
    try {
      await net.host(code);
      local.code = code;
      state.code = code; // painted on the board at the dock
      opened = true;
    } catch (err) {
      // A taken code: pick another. A server hiccup: knock again.
      if (SERVER_TROUBLE.has(err.message) && hiccups < 3) {
        hiccups += 1;
        await wait(1000 * hiccups);
      } else if (SERVER_TROUBLE.has(err.message)) {
        note('Could not open a room. Check your connection.');
        return;
      } else if (err.message !== 'taken') {
        note('Could not open a room. Check your connection.');
        return;
      }
      failure = err.message;
    }
  }
  if (!opened) {
    note(failure === 'taken' ? 'Every room code was taken. Try again.' : 'Could not open a room. Check your connection.');
    return;
  }

  const me = newPlayer(local.id, local.name, 0);
  state.players[me.id] = me;
  bodies.set(me.id, player.body);
  inputs.set(me.id, emptyInput());
  note('');
  // The crew screen first: the code to read out, and who has joined.
  state.phase = 'gathering';
  state.countdown = null;
  startSession();
}

// Each try gets a number; a cancelled one that answers late is ignored.
let joinAttempt = 0;
// PeerJS error types that mean the signalling server, not the ship, failed.
const SERVER_TROUBLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function joinGame(code) {
  const attempt = ++joinAttempt;
  local.name = playerName();
  local.isHost = false;
  try {
    // A seat this tab held on this ship before (a reload, a dropped line)
    // is asked for back. The public signalling server sometimes drops a
    // knock, a few in a row when busy: keep knocking, a little slower each
    // time, for about ten seconds before telling the player.
    const token = savedSeat(code)?.token ?? null;
    let welcome = null;
    for (let tries = 0; !welcome; tries++) {
      try {
        welcome = await net.join(code, local.name, token);
      } catch (err) {
        if (attempt !== joinAttempt) return;
        if (tries >= 4 || !SERVER_TROUBLE.has(err.message)) throw err;
        await wait(1000 * (tries + 1));
        if (attempt !== joinAttempt) return;
      }
    }
    if (attempt !== joinAttempt) return;
    board(welcome, code);
    joinSucceeded(code, state.players.host?.name ?? 'The host');
    startSession();
  } catch (err) {
    if (attempt !== joinAttempt) return;
    net.close({ bye: false });
    joinFailed(err.message, code);
  }
}

// Aboard (again): who we are now, and the ship as the host has it.
function board(welcome, code) {
  local.id = welcome.id;
  local.code = code;
  local.token = welcome.token;
  rememberSeat(code, welcome.id, welcome.token);
  clockOffset = null;
  sentAt.clear();
  player.forget();
  crew.delay = 2000 / RULES.stateHz;
  pending = emptyInput(); // presses made while the line was down are stale now
  applySnapshot(welcome.s);
  lastStateAt = performance.now();
}

// The seat token lives in the tab (sessionStorage), so a reload can still
// claim the seat back, but a second tab never takes the first one's seat.
function savedSeat(code) {
  try {
    const seat = JSON.parse(sessionStorage.getItem('patchitup-seat') ?? 'null');
    return seat?.code === code ? seat : null;
  } catch {
    return null;
  }
}
function rememberSeat(code, id, token) {
  try {
    sessionStorage.setItem('patchitup-seat', JSON.stringify({ code, id, token }));
  } catch {
    // storage blocked: a reload just gets a fresh seat
  }
}
function forgetSavedSeat() {
  try {
    sessionStorage.removeItem('patchitup-seat');
  } catch {
    // nothing to forget
  }
}

// The line to the host broke (or went silent): try to get back aboard,
// into the same seat, for as long as the host holds it for us. Only if
// that fails is the player sent back to the menu.
let rejoining = false;
async function rejoin() {
  if (rejoining || !sessionActive || local.isHost) return;
  rejoining = true;
  const attempt = ++joinAttempt;
  const giveUpAt = performance.now() + RULES.rejoinMs;
  const { code, token } = local;
  const oldId = local.id;
  netNote.hidden = false;
  net.close({ bye: false });
  let reason = 'Lost the connection to the ship';
  while (performance.now() < giveUpAt) {
    try {
      const welcome = await net.join(code, local.name, token);
      if (attempt !== joinAttempt) return;
      rejoining = false;
      netNote.hidden = true;
      board(welcome, code);
      // A different seat (the old one was given up): start from its spot.
      if (welcome.id !== oldId) {
        inWorld = false;
        startSession();
      }
      return;
    } catch (err) {
      if (attempt !== joinAttempt) return;
      net.close({ bye: false });
      if (err.message === 'Ship is full') {
        reason = 'Your seat was taken while you were away';
        break;
      }
      await wait(1500);
      if (attempt !== joinAttempt) return;
    }
  }
  leaveShip(reason, { keepSeat: true });
}

// The host's book of who is connected, emptied between sessions.
function forgetSeats() {
  lastHeard.clear();
  lostAt.clear();
  seatTokens.clear();
  acks.clear();
  hostInteractions.holds.clear();
}

function startSession() {
  sessionActive = true;
  inWorld = false;
  // Flights count from 1 again in every session.
  flownFlight = -1;
  shownResult = -1;
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
  // The game on screen with the mouse free: "Click to play" must be there
  // to take it back. The result screen frees the mouse and hides the
  // overlay, so without this a crew sent back to the dock after a flight
  // could not move at all (and had nothing to click).
  if (playing && !player.controls.isLocked && !trainingFinished()) lockOverlay.hidden = false;
  if (state.phase === 'result') {
    if (player.controls.isLocked) player.controls.unlock();
    if (shownResult !== state.flight) {
      shownResult = state.flight;
      showResult(state, {
        flew: flownFlight === state.flight,
        colorOf: (role) => ROLE_COLORS[role] ?? ROLE_COLORS.crew,
      });
    }
    // Only the host sends the crew up again or back down; joiners wait.
    const waiting = sessionActive && !local.isHost;
    resultBack.disabled = waiting;
    resultBack.textContent = waiting ? 'Waiting for the host...' : 'Back to dock';
    resultAgain.hidden = waiting || !sessionActive;
  }
}

// keepSeat: the line broke rather than the player leaving, so joining the
// same code again (while the host still holds the seat) gets it back.
function leaveShip(message = '', { keepSeat = false } = {}) {
  if (trainingActive()) {
    stopTraining();
    game.setTraining(false);
  }
  sessionActive = false;
  inWorld = false;
  joinAttempt += 1; // a reconnect in progress stops here
  rejoining = false;
  netNote.hidden = true;
  if (!keepSeat) forgetSavedSeat();
  player.controls.unlock();
  net.close(); // goodbye to whoever is still connected, so nobody waits for us
  endVoice();
  state.players = {};
  bodies.clear();
  inputs.clear();
  forgetSeats();
  crew.sync({}, local.id);
  game.newSession(); // the ship behind the menu: no holes or fires left from that flight
  playUi.hidden = true;
  player.toggleView(false); // back to first person, own character hidden
  player.exit(scene);
  resetDockEffects();
  resetHelmEffects();
  resetPowerEffects();
  resetEngineEffects();
  resetPirateEffects(world);
  raidAlert.hidden = true;
  resetGathering();
  resetSubtitles();
  clearJobList();
  seenCallout = null;
  calloutBox.hidden = true;
  seenStormHits = null;
  alertBox.hidden = true;
  if (isSettingsOpen()) closeSettings();
  refreshNameChip();
  note(message);
  showScreen('menu');
  showTrainingButtons();
  syncMic();
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

// Closing the tab: a host says goodbye so the crew is told at once rather
// than waiting out a reconnect. A joiner does not, so a reload can still
// take its seat back.
addEventListener('pagehide', () => {
  if (sessionActive && local.isHost) net.close();
});

player.controls.addEventListener('lock', () => (lockOverlay.hidden = true));
player.controls.addEventListener('unlock', () => {
  if (sessionActive && state.phase !== 'result' && !trainingFinished()) lockOverlay.hidden = false;
});
document.getElementById('skipLesson').addEventListener('click', () => {
  skipLesson();
  // Back into the game, unless that was the last lesson: the finish panel
  // needs the mouse for its buttons.
  if (!trainingFinished()) player.controls.lock();
});
document.getElementById('trainingMenu').addEventListener('click', () => leaveShip());
document.getElementById('trainingHost').addEventListener('click', () => {
  leaveShip();
  hostGame();
});
document.getElementById('clickToPlay').addEventListener('click', () => player.controls.lock());
// Settings mid-game: the game goes on underneath (it is online), and
// "Click to play" is waiting when the page closes.
document.getElementById('openSettings').addEventListener('click', () => openSettings(syncMic));
document.getElementById('leaveShip').addEventListener('click', () => leaveShip());
document.getElementById('resultBack').addEventListener('click', () => {
  if (!sessionActive) {
    showScreen('menu');
    return;
  }
  // Only the host decides; a joiner's button is disabled until then. The
  // click also takes the mouse back, so the host is straight back in play.
  if (local.isHost) {
    returnToDock();
    player.controls.lock();
  }
});
// Straight back up: same crew, same uniforms, same route, still aboard.
resultAgain.addEventListener('click', () => {
  if (!sessionActive || !local.isHost) return;
  if (game.flyAgain()) player.controls.lock();
});

// --- the loop --------------------------------------------------------

// One input is built every frame but only sent 30 times a second, so a
// tap or a drop made in between has to wait in here rather than vanish.
let pending = emptyInput();
let flyMismatch = 0; // joiner: how long our flight state has disagreed with the host's
function queue(input) {
  pending.keys = input.keys;
  pending.yaw = input.yaw;
  pending.pitch = input.pitch;
  pending.use = input.use;
  pending.useTap = pending.useTap || input.useTap;
  pending.drop = pending.drop || input.drop;
  pending.bell = pending.bell || input.bell;
  pending.callout = pending.callout || input.callout;
  pending.wave = pending.wave || input.wave;
  pending.flyTap = pending.flyTap || input.flyTap;
}

function hostTick(dt, now) {
  const me = state.players[local.id];
  if (me) {
    me.mic = micState();
    me.stars = totalStars();
  }
  for (const id of Object.keys(state.players)) {
    if (id === local.id) continue;
    const seated = state.players[id];
    if (seated.signal === 'lost') {
      if (now - (lostAt.get(id) ?? now) > RULES.rejoinMs) dropPlayer(id);
      continue;
    }
    const heard = lastHeard.get(id) ?? now;
    if (now - heard > RULES.timeoutMs) holdSeat(id);
    else seated.signal = now - heard > RULES.weakSignalMs ? 'weak' : 'good';
    // Which input this state answers, and how long it has been steering
    // them since it came: the joiner checks its own prediction with it.
    const ack = acks.get(id);
    if (ack) {
      seated.ack = ack.seq;
      seated.ackAge = Math.round(now - ack.at);
    }
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
    // Flying comes with the uniform: a deckhand could otherwise float
    // over the gate at the foot of the gangplank.
    if (seated.role === 'crew') {
      input.flyTap = false;
      body.flying = false;
    }
    stepBody(body, input, collidersFor(seated.role), dt, groundAt);
    seated.x = body.position.x;
    seated.y = body.position.y;
    seated.z = body.position.z;
    seated.yaw = input.yaw ?? seated.yaw;
    // What the others need to animate you: where you look, whether you are
    // off the ground, and a wave counter (counters survive a lost packet).
    seated.pitch = input.pitch ?? 0;
    seated.air = !body.onGround;
    seated.flying = !!body.flying;
    if (input.wave) {
      seated.waves = (seated.waves ?? 0) + 1;
      input.wave = false;
    }

    if (seated.atWheel) game.steerShip(dt, input.keys ?? {});
    if (input.drop) {
      game.dropKit(seated, body, input.yaw ?? 0);
      input.drop = false;
    }
    // The pilot's bell key rings the cabin bell from anywhere aboard.
    if (input.bell) {
      input.bell = false;
      if (game.covers(seated, 'pilot')) game.ringCabinBell();
    }
    if (input.callout) {
      input.callout = false;
      game.callOut(seated);
    }
  }

  if (state.phase === 'lobby') game.tickLobby(dt);
  else if (state.phase === 'takeoff') game.tickTakeoff(dt);
  else if (state.phase === 'flight') game.tickFlight(dt, { bodies, inputs });
  else if (state.phase === 'ending') game.tickEnding(dt);

  hostInteractions.update(dt, state.players, bodies, inputs, {
    canUse: game.canUse,
    run: (interact, seated, body) => {
      const done = game.ACTIONS[interact.action]?.(interact, seated, body);
      // Every use counts, so the others see an arm reach out.
      if (done !== false) seated.uses = (seated.uses ?? 0) + 1;
      return done;
    },
  });
  // Holding E on a breach: the others see you kneel and hammer.
  for (const seated of Object.values(state.players)) {
    const hold = hostInteractions.holds.get(seated.id);
    const holding = hold?.target?.userData.interact?.action;
    seated.act = holding === 'patch' || holding === 'cutHook' ? 'patch' : null;
  }

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
  timerText.textContent = game.inTraining() ? 'Training' : `${minutes}:${String(seconds).padStart(2, '0')}`;
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

  // The helm gauge, for whoever holds the wheel.
  const steeringNow = state.phase === 'flight' && !!state.players[local.id]?.atWheel;
  helmGauge.hidden = !steeringNow;
  if (steeringNow) {
    const pct = (v) => `${((v + 1) / 2) * 100}%`;
    helmShip.style.left = pct(state.drift);
    helmShip.classList.toggle('at-edge', Math.abs(state.drift) >= 0.999);
    helmRock.hidden = !state.rock.active;
    if (state.rock.active) {
      const lo = Math.max(-1, state.rock.lane - RULES.rockHitWidth);
      const hi = Math.min(1, state.rock.lane + RULES.rockHitWidth);
      helmRock.style.left = pct(lo);
      helmRock.style.width = `${((hi - lo) / 2) * 100}%`;
    }
  }
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
  if (heldBy === local.id && !player.thirdPerson) {
    if (kit.parent !== camera) camera.add(kit);
    kit.position.set(0.48, -0.4, -1);
    kit.rotation.set(0, 0.5, 0);
    return;
  }
  // In someone's arms: the character's hold socket, or in front of a sphere.
  const carrier = heldBy === local.id ? player.avatar?.root : crew.meshFor(heldBy);
  const character = carrier?.userData.character;
  const hands = character?.holdSocket ?? carrier;
  if (hands && kit.parent !== hands) hands.add(kit);
  if (hands) {
    if (character) kit.position.set(0, 0, 0);
    else kit.position.set(0, 0.15, -0.5);
    kit.rotation.set(0, 0, 0);
  }
}

// Your own character: only seen in third person, but always kept up to
// date so switching views never shows a frozen pose.
function updateOwnCharacter(dt, ctx) {
  const me = state.players[local.id];
  if (!me || !inWorld) return;
  const color = ROLE_COLORS[me.role] ?? ROLE_COLORS.crew;
  const avatar = player.ensureAvatar(me.role, color);
  player.viewColliders = collidersFor(me.role);
  if (avatar) {
    avatar.setColor(color);
    setHat(avatar.root, me.hat ?? 0);
    player.updateAvatar(dt, me, {
      bodyYaw: me.atWheel ? ctx.wheelYaw : undefined,
      steering: me.atWheel ? ctx.steering : 0,
      carrying: ctx.kitHolder === local.id || !!me.bucket,
    });
  }
  player.syncView(dt);
}

// What each role is for, read out while the ship climbs, with the keys
// the player has actually bound.
const JOBS = {
  mechanic: () =>
    `Mechanic: patch the breaches (hold ${keyLabel(settings.keys.interact)}), keep the furnace stoked, and put out fires with the buckets in the engine room.`,
  engineer: () =>
    'Engineer: the levers put power in, the handles below take it out. Lift holds her up, engines steer, shields stop rocks. Vent hot tubes in time: the valve needs 20 s to recharge.',
  pilot: () =>
    `Pilot: hold A or D to steer round the rocks; let go and the wheel centres. Keep the gauge's marker out of the red band. When a storm wall comes, ring the bell (${keyLabel(settings.keys.bell)}) so the crew can brace.`,
};

// --- the end of a flight -------------------------------------------------

// She goes down (or burns) for a few seconds, or comes in to the harbour,
// before the result screen. The host's ending.t paces it, so the card,
// the sounds, the dive and the crash land on every screen together.
const ENDING_CUES = {
  down: [
    { at: 0, sound: 'engineer_steam_hiss', volume: 0.9 },
    { at: 1.2, sound: 'engineer_lever_clunk', volume: 0.7 },
    { at: RULES.sinkingSeconds - 0.4, sound: 'mechanic_cannonball_rack_clunk', volume: 1, jolt: true },
  ],
  burned: [
    { at: 0, sound: 'mechanic_furnace_whoosh', volume: 1 },
    { at: 1.2, sound: 'engineer_steam_hiss', volume: 0.7 },
    { at: RULES.sinkingSeconds - 0.4, sound: 'mechanic_cannonball_rack_clunk', volume: 1, jolt: true },
  ],
  landed: [
    { at: 0, sound: 'ui_ping_chime', volume: 0.8 },
    { at: 0.6, sound: 'engineer_lever_clunk', volume: 0.9 }, // the hatch swings open
    { at: 1.2, sound: 'dock_ship_bell_ding', volume: 0.6 },
    { at: RULES.landingSeconds - 0.7, sound: 'dock_ship_bell_ding', volume: 0.9 }, // moored
  ],
}; // each list in order of time
let endingCues = { flight: -1, next: 0 };
let endJolt = 0; // when she hit, for the camera jolt

function endingWords(end) {
  if (end.kind === 'landed') {
    return end.t < RULES.landingSeconds - 0.8
      ? ['Harbour in sight!', 'Still in one piece. Bringing her in...']
      : ['Moored!', 'Well flown, crew.'];
  }
  if (end.kind === 'burned') return ["She's burning!", 'Fire in every room. Hold on to something!'];
  return ['Going down!', 'No height left. Hold on to something!'];
}

function updateEnding(now) {
  const end = state.phase === 'ending' ? state.ending : null;
  if (!end) return;
  const [title, line] = endingWords(end);
  if (endingTitle.textContent !== title) endingTitle.textContent = title;
  if (endingLine.textContent !== line) endingLine.textContent = line;
  endingScreen.classList.toggle('home', end.kind === 'landed');
  endingScreen.classList.toggle('crash', now - endJolt < 450);

  if (endingCues.flight !== state.flight) {
    endingCues = { flight: state.flight, next: 0 };
    if (end.t < 1) sting(end.kind === 'landed' ? 'home' : 'down');
  }
  const cues = ENDING_CUES[end.kind] ?? [];
  while (endingCues.next < cues.length && end.t >= cues[endingCues.next].at) {
    const cue = cues[endingCues.next++];
    if (end.t - cue.at > 0.6) continue; // arrived late: not every sound at once
    play(cue.sound, cue.volume);
    if (cue.jolt) endJolt = now;
  }
}

// Inside the hull the ship's own dive can't be seen (the camera rides with
// her), so going down rolls and shakes the view itself, and the crash at
// the end gives it a last jolt. None with camera motion off.
let rolled = false;
function rollView(t, now, sinking, motion) {
  const crashed = (now - endJolt) / 1000;
  const crash = crashed < 0.8 ? Math.sin(crashed * 45) * 0.05 * (1 - crashed / 0.8) : 0;
  const roll = ((Math.sin(t * 1.6) * 0.07 + Math.sin(t * 27) * 0.012) * sinking + crash) * motion;
  if (!roll && !rolled) return;
  camera.rotation.z = roll;
  rolled = roll !== 0;
}

// 0 .. 1 over the first second and a bit of going down (or burning).
function sinkingShare() {
  const end = state.phase === 'ending' ? state.ending : null;
  if (!end || end.kind === 'landed') return 0;
  return Math.min(1, end.t / 1.2);
}

// The sky closes in, dark (or fire-lit), as she goes down, and opens up
// over the harbour; eased, and back to the storm for the next flight.
const SKY = {
  base: { color: new THREE.Color('#353a68'), near: 30, far: 160 },
  down: { color: new THREE.Color('#1b1c30'), near: 14, far: 80 },
  burned: { color: new THREE.Color('#4a272c'), near: 14, far: 80 },
  landed: { color: new THREE.Color('#5d6599'), near: 40, far: 200 },
};
const storm = { color: new THREE.Color('#353a68'), near: 30, far: 160 };
const HARBOUR = {
  top: new THREE.Color('#3f8fe0'),
  horizon: new THREE.Color('#cfe8fb'),
  bottom: new THREE.Color('#eef5ff'),
  fog: new THREE.Color('#cfe4f7'),
  near: 35,
  far: 290,
};
// How fair the weather is: 1 in the sunny harbour (the menu, the dock, a
// landing coming in), 0 in the storm, in between on the way up or down.
function fairWeather() {
  if (!sessionActive || state.phase === 'lobby' || state.phase === 'gathering') return 1;
  const landing = (state.phase === 'ending' && state.ending?.kind === 'landed') || (state.phase === 'result' && state.result === 'landed');
  if (state.phase === 'takeoff' || landing) return 1 - takeoffProgress(state);
  return 0;
}
let fair = 1;
const HEMI = {
  storm: { sky: new THREE.Color('#ffd9a0'), ground: new THREE.Color('#b5a493') },
  fair: { sky: new THREE.Color('#f6ead6'), ground: new THREE.Color('#c9ac8c') },
};
function updateSky(dt) {
  const over = state.phase === 'ending' || state.phase === 'result';
  const to = (sessionActive && over && SKY[state.result]) || SKY.base;
  const k = Math.min(1, dt * 1.5);
  storm.color.lerp(to.color, k);
  storm.near += (to.near - storm.near) * k;
  storm.far += (to.far - storm.far) * k;
  fair = fairWeather();
  const dome = world.harbour?.dome.material.uniforms;
  if (dome) {
    dome.top.value.copy(storm.color).lerp(HARBOUR.top, fair);
    dome.horizon.value.copy(storm.color).lerp(HARBOUR.horizon, fair);
    dome.bottom.value.copy(storm.color).lerp(HARBOUR.bottom, fair);
  }
  scene.fog.color.copy(storm.color).lerp(HARBOUR.fog, fair);
  scene.background.copy(scene.fog.color);
  scene.fog.near = storm.near + (HARBOUR.near - storm.near) * fair;
  scene.fog.far = storm.far + (HARBOUR.far - storm.far) * fair;
  // In the harbour the sun does the work and the fill lights step back, so
  // light and shade read; in the storm, the cabin's old lighting.
  lights.harbourSun.intensity = 2.6 * fair;
  lights.harbourSun.castShadow = fair > 0.02;
  lights.sun.intensity = 1.3 - 0.6 * fair;
  lights.hemi.intensity = 2.8 - 0.3 * fair;
  lights.hemi.color.copy(HEMI.storm.sky).lerp(HEMI.fair.sky, fair);
  lights.hemi.groundColor.copy(HEMI.storm.ground).lerp(HEMI.fair.ground, fair);
}

// Who throws a shadow: anything solid in the ship and on the dock (models
// arrive late, so this looks again now and then). Glass, flames, glows
// and labels do not; everything receives, so the roof shades the cabin.
let shadowsCheckedAt = 0;
function markShadows(now) {
  if (now - shadowsCheckedAt < 2000) return;
  shadowsCheckedAt = now;
  ship.traverse((o) => {
    if (!o.isMesh || o.userData.shadowSet) return;
    o.userData.shadowSet = true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const see = m && !m.transparent && !(m.emissiveIntensity > 0.5 && m.emissive?.getHex()) && o.geometry?.type !== 'PlaneGeometry';
    o.castShadow = !!see;
    o.receiveShadow = true;
  });
}

// The music: calm at the menu and the dock, steady in the air, epic when
// it goes wrong (a storm wall coming, pirates, fire, the ship low). The
// epic tune holds a while after the danger passes, so it doesn't flicker.
// Silence for the ending's sting, then the harbour tune again.
const DANGER_HOLD_MS = 9000;
const AFTER_STING_MS = 3500;
let dangerUntil = 0;
let musicPhase = null;
let musicPhaseSince = 0;
function musicMood(now) {
  if (!sessionActive) return 'harbour';
  const phase = state.phase;
  if (phase !== musicPhase) {
    musicPhase = phase;
    musicPhaseSince = now;
  }
  if (phase !== 'flight') dangerUntil = 0;
  if (phase === 'ending') return null;
  if (phase === 'result') return now - musicPhaseSince > AFTER_STING_MS ? 'harbour' : null;
  if (phase === 'takeoff') return 'underway';
  if (phase !== 'flight') return 'harbour';
  if (trainingActive()) return 'underway';
  const raid = state.raid?.phase;
  const danger =
    state.storm?.active ||
    raid === 'sighted' ||
    raid === 'alongside' ||
    Object.values(state.fires ?? {}).some(Boolean) ||
    state.altitude < 25;
  if (danger) dangerUntil = now + DANGER_HOLD_MS;
  return now < dangerUntil ? 'storm' : 'underway';
}

function updateMusicNow(now) {
  setMood(musicMood(now), { fast: state.phase === 'ending' });
  // Down under a teammate's voice, so the crew can hear each other.
  duckMusic(sessionActive && Object.keys(state.players).some((id) => id !== local.id && isSpeaking(id, now)));
  updateMusic();
}

// The climb: what is happening, then your job, then a last call.
let seenPhase = null;
let seenHatch = false;
function updateTakeoff() {
  const phase = state.phase;
  if (phase === 'takeoff' && (seenPhase === 'lobby' || seenPhase === 'result')) play('engineer_steam_hiss', 0.6); // moorings off
  seenPhase = phase;
  const shut = hatchShut(state);
  if (shut && !seenHatch && phase === 'takeoff') play('engineer_lever_clunk', 0.8); // the hatch slams
  seenHatch = shut;
  if (phase !== 'takeoff') return;

  takeoffTitle.textContent =
    state.takeoff < 1.5 ? 'Casting off!' : !hatchShut(state) ? 'Climbing to cruising height' : 'Hatch shut. Brace yourselves!';
  const role = state.players[local.id]?.role;
  const empty = ROLES.filter((r) => !roleTaken(r));
  const crew = playerCount();
  let job = JOBS[role]?.() ?? '';
  if (crew === 1) job = 'Flying solo: every station is yours, and the sky goes easier on a crew of one.';
  else if (empty.length) job += ` Short-handed: nobody is the ${empty.join(' or ')}, so that job is anyone's.`;
  takeoffJob.textContent = job;
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

  // The fire that will spread soonest.
  const fires = Object.entries(state.fires).filter(([, fire]) => fire);
  hazardRow.hidden = !fires.length;
  if (fires.length) {
    const [room, fire] = fires.sort((a, b) => b[1].spread - a[1].spread)[0];
    const left = Math.max(0, Math.ceil(game.fireSpreadSeconds() - fire.spread));
    const more = fires.length > 1 ? ` (+${fires.length - 1} more)` : '';
    hazardText.textContent = `Fire: ${game.ROOM_LABEL[room]}${more} · spreads in ${left} s`;
  }
}
const hazardRow = document.getElementById('hazardRow');
const hazardText = document.getElementById('hazardText');

// Pirates alongside, on the ship panel: what is holding on, and how long
// before they take their loot and go.
const raidRow = document.getElementById('raidRow');
const raidText = document.getElementById('raidText');
function updateRaidRow() {
  const raid = state.raid;
  raidRow.hidden = raid.phase !== 'alongside';
  if (raidRow.hidden) return;
  const hooks = Object.keys(raid.hooks).length;
  const aboard = Object.keys(raid.boarders).length;
  const left = Math.max(0, Math.ceil(RULES.raidMaxSeconds - raid.t));
  const parts = [`${hooks} grapple${hooks === 1 ? '' : 's'}`];
  if (aboard) parts.push(`${aboard} aboard`);
  raidText.textContent = `Pirates: ${parts.join(' · ')} · loot in ${left} s`;
}

// The pirate alarm. Like the storm wall, only the pilot sees their ship
// coming (through the window, or the telescope) and has to tell the crew;
// once it is alongside, everyone is told what to do about it.
const raidAlert = document.getElementById('raidAlert');
const raidTitle = document.getElementById('raidTitle');
const raidLine = document.getElementById('raidLine');
function updateRaidAlert() {
  const raid = state.raid;
  const pilot = game.covers(state.players[local.id], 'pilot');
  const key = keyLabel(settings.keys.interact);
  const side = raid.side > 0 ? 'starboard' : 'port';
  let title = '';
  let line = '';
  if (state.phase === 'flight' && raid.phase === 'sighted' && pilot) {
    const engines = livePower(0) >= RULES.raidOutrunEngines;
    title = `Pirates to ${side}!`;
    line = engines
      ? `Outrunning them: ${Math.max(0, Math.ceil(RULES.raidOutrun - raid.outrun))} s more at full engines`
      : `Alongside in ${Math.max(0, Math.ceil(RULES.raidApproach - raid.t))} s · engines to ${RULES.raidOutrunEngines} to outrun them`;
  } else if (state.phase === 'flight' && raid.phase === 'alongside') {
    const hooks = Object.keys(raid.hooks).length;
    const aboard = Object.keys(raid.boarders).length;
    title = aboard ? 'Pirates aboard!' : `Pirates to ${side}!`;
    const jobs = [];
    if (hooks) jobs.push(`hold ${key} on a grapple to cut it`);
    if (aboard) jobs.push(`tap ${key} to shove a boarder overboard`);
    line = jobs.length ? jobs.join(' · ') : `Shields to ${RULES.raidShieldBlock} stop their cannonballs`;
  }
  raidAlert.hidden = !title;
  if (raidTitle.textContent !== title) raidTitle.textContent = title;
  if (raidLine.textContent !== line) raidLine.textContent = line;
}

// The storm alarm. The pilot sees the wall coming and is told to ring the
// bell; everyone else only hears about it once the bell rings. Then a
// flash and a jolt when it hits.
const alertBox = document.getElementById('alert');
const alertTitle = document.getElementById('alertTitle');
const alertText = document.getElementById('alertText');
let seenStormHits = null;
let stormJolt = 0; // when the last hit landed, for the camera jolt
function updateStormAlert(now) {
  const storm = state.storm;
  const me = state.players[local.id];
  const pilot = game.covers(me, 'pilot'); // the pilot, or anyone if nobody is
  const showing = state.phase === 'flight' && storm.active && (pilot || storm.warned);
  alertBox.hidden = !showing;
  if (showing) {
    const left = Math.ceil(storm.left);
    alertBox.classList.toggle('braced', !!me?.braced);
    if (pilot && !storm.warned) {
      alertTitle.textContent = 'Storm wall!';
      alertText.textContent = `Impact in ${left} · ring the bell (${keyLabel(settings.keys.bell)}) so the crew braces`;
    } else {
      alertTitle.textContent = me?.braced ? 'Braced ✓' : 'BRACE! Storm wall';
      alertText.textContent = me?.braced
        ? `Impact in ${left} · keep holding`
        : `Impact in ${left} · hold ${keyLabel(settings.keys.interact)} to hold on`;
    }
  }
  if (seenStormHits === null) seenStormHits = storm.hits;
  if (storm.hits < seenStormHits) seenStormHits = storm.hits; // a fresh round, not a hit
  if (storm.hits !== seenStormHits) {
    seenStormHits = storm.hits;
    stormJolt = now;
    flashUntil = now + 700;
    flash.classList.add('storm');
    play('mechanic_cannonball_rack_clunk', 0.9);
  }
  if (now > flashUntil) flash.classList.remove('storm');
}

// A fuse or a bucket shows in the hands that carry it: yours in front of
// the camera, a teammate's in front of their sphere.
const heldMeshes = new Map(); // player id -> { kind, mesh }
function heldMesh(kind) {
  const group = new THREE.Group();
  if (kind === 'bucket') {
    const pail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.12, 0.26, 12),
      new THREE.MeshStandardMaterial({ color: '#4a86e8', flatShading: true })
    );
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: '#9fd3ec', emissive: '#3a7fb0' })
    );
    water.position.y = 0.11;
    group.add(pail, water);
  } else {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: '#d9a43a', flatShading: true })
    );
    body.rotation.z = Math.PI / 2;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: '#e2574c' })
    );
    band.rotation.z = Math.PI / 2;
    group.add(body, band);
  }
  return group;
}
function updateHeldItems() {
  for (const player of Object.values(state.players)) {
    const kind = player.bucket ? 'bucket' : player.fuse ? 'fuse' : null;
    const mine = player.id === local.id;
    // First person: in front of the camera. Otherwise in the character's
    // arms (its hold socket), or in front of a sphere before it loads.
    const firstPerson = mine && !player.thirdPerson;
    const carrier = mine ? (inWorld ? player.avatar?.root ?? null : null) : crew.meshFor(player.id);
    const character = firstPerson ? null : carrier?.userData.character;
    const holder = firstPerson ? (inWorld ? camera : null) : character?.holdSocket ?? carrier;
    let held = heldMeshes.get(player.id);
    if (held && (held.kind !== kind || held.mesh.parent !== holder)) {
      held.mesh.removeFromParent();
      heldMeshes.delete(player.id);
      held = null;
    }
    if (!kind || !holder || held) continue;
    const mesh = heldMesh(kind);
    mesh.userData.held = true;
    if (firstPerson) mesh.position.set(0.42, -0.38, -0.9);
    else if (character) mesh.position.set(0, -0.05, 0.02);
    else mesh.position.set(0.32, 0.05, -0.45);
    holder.add(mesh);
    heldMeshes.set(player.id, { kind, mesh });
  }
  for (const [id, held] of heldMeshes) {
    if (!state.players[id]) {
      held.mesh.removeFromParent();
      heldMeshes.delete(id);
    }
  }
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
  const crew = crewList.length;
  const short = crew < RULES.maxPlayers;
  if (state.countdown !== null) {
    banner.textContent = `Casting off in ${Math.ceil(state.countdown)}${short ? ` with ${crew} crew` : ''}`;
    return;
  }
  const lost = crewList.find((p) => p.signal === 'lost');
  if (lost) {
    banner.textContent = `Waiting for ${lost.name} to reconnect`;
    return;
  }
  // Short of three: the host's ring of the dock bell says go anyway.
  if (short && !state.shortHanded) {
    const go = crew === 1 ? 'fly solo' : `cast off with ${crew}`;
    banner.textContent = local.isHost
      ? `${crew} of ${RULES.maxPlayers} crew · wait for more, or ring the dock bell to ${go}`
      : `${crew} of ${RULES.maxPlayers} crew · ${state.players.host?.name ?? 'The host'} can ring the dock bell to ${go}`;
    return;
  }
  banner.textContent = crewList.some((p) => p.role === 'crew') ? 'Waiting for everyone to dress' : 'All aboard: up the gangplank';
}

function updateStatus() {
  const me = state.players[local.id];
  if (!me) return;
  const away = state.phase === 'takeoff' || state.phase === 'flight'; // at the dock, uniforms are still being picked
  const extra = me.role === 'crew' || !away ? [] : ROLES.filter((r) => r !== me.role && !roleTaken(r));
  const role = me.role === 'crew' ? 'No uniform' : [me.role, ...extra].join(' + ').replace(/^./, (c) => c.toUpperCase());
  const holding = me.fuse
    ? 'a spare fuse'
    : me.bucket
      ? 'a bucket of water'
      : state.kit.heldBy === me.id
      ? `the patch kit (${state.kit.planks} plank${state.kit.planks === 1 ? '' : 's'})`
      : 'nothing';
  const names = Object.values(state.players)
    .map((p) => (p.id === local.id ? `${p.name} (you)` : p.signal === 'lost' ? `${p.name} (reconnecting)` : p.name))
    .join(', ');
  // Power and the rudder only mean something once the ship is flying.
  const parts = [
    game.inTraining() ? 'Training (solo, offline)' : `Room ${local.code}${local.isHost ? ' (host)' : ''}`,
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

// The network and, on the host, the game itself: run by every frame, and
// by the pulse below while frames have stopped (a hidden, minimised or
// covered window), so nobody is dropped for looking at another window.
let lastStepAt = performance.now();

// The simulation moves in steps of at most 50 ms: a slow frame runs
// several of them, so a host drawing 8 frames a second still flies the
// ship at full speed. (One step per frame, capped at 0.1 s, slowed the
// whole crew down with the host's frame rate.) A long stall, such as a
// tab hidden before the pulse takes over, catches up a quarter of a
// second at most, so nobody is teleported through a wall.
const SUBSTEP = 0.05;
const MAX_CATCH_UP = 0.25;
const substeps = (dt) => Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));

function step(now) {
  const dt = Math.min((now - lastStepAt) / 1000, MAX_CATCH_UP);
  lastStepAt = now;
  if (!sessionActive) return dt;
  if (state.phase === 'flight') flownFlight = state.flight;
  syncPhaseUi();

  if (state.phase === 'gathering') {
    player.readInput(); // keys typed on this screen are not for walking
    if (local.isHost) hostTick(dt, now);
    else joinerTick(emptyInput(), dt, now, false); // still here, so the host keeps our seat
    return dt;
  }

  const input = player.readInput();
  if ((state.players[local.id]?.role ?? 'crew') === 'crew') input.flyTap = false; // no flying before the uniform
  predictWheel(dt, input.keys ?? {});
  if (local.isHost) {
    // The host plays through the same pipe as everyone else.
    const own = inputs.get(local.id);
    if (own) {
      Object.assign(own, input, {
        useTap: own.useTap || input.useTap,
        drop: own.drop || input.drop,
        bell: own.bell || input.bell,
        callout: own.callout || input.callout,
        wave: own.wave || input.wave,
        flyTap: own.flyTap || input.flyTap,
      });
    }
    const n = substeps(dt);
    for (let i = 0; i < n; i++) hostTick(dt / n, now); // a tap is used up by the first
  } else {
    joinerTick(input, dt, now, inWorld);
  }
  return dt;
}

// The wheel as this browser draws it. The host's state.steering is the
// truth, but it comes back a round trip after a joining pilot presses a
// key; their own wheel turns at once with the same rule (nextSteering),
// and drifts back toward the host's answer as it arrives. Only the wheel,
// the needle and the shoulders use it: the rock, the tilt and the rain
// show where the host says the ship really is.
let shownSteering = 0;
function predictWheel(dt, keys) {
  const me = state.players[local.id];
  if (local.isHost || !me?.atWheel || state.phase !== 'flight') {
    shownSteering = state.steering ?? 0;
    return;
  }
  shownSteering = game.nextSteering(shownSteering, keys, dt);
  shownSteering += ((state.steering ?? 0) - shownSteering) * Math.min(1, dt * 2);
}

function joinerTick(input, dt, now, walking) {
  // Nothing from the host for a while: the line is dead even if it has not
  // said so. Get back aboard if we can (this keeps trying in the background).
  if (now - lastStateAt > RULES.timeoutMs) rejoin();

  if (walking) {
    player.body.atWheel = state.players[local.id]?.atWheel ?? false;
    // In the same small steps as the host, so a slow frame walks as far.
    const n = substeps(dt);
    const colliders = collidersFor(state.players[local.id]?.role ?? 'crew');
    for (let i = 0; i < n; i++) player.predict(input, dt / n, colliders, groundAt);
    player.record(now);
    // Flying is predicted here too; if the host disagrees for a moment
    // (a tap it never saw), follow the host.
    const hostFlying = state.players[local.id]?.flying;
    if (hostFlying !== undefined && hostFlying !== !!player.body.flying) {
      flyMismatch += dt;
      if (flyMismatch > 0.5) {
        player.body.flying = hostFlying;
        flyMismatch = 0;
      }
    } else {
      flyMismatch = 0;
    }
  }

  queue(input);
  pending.seq = inputSeq + 1;
  pending.mic = micState();
  pending.stars = totalStars();
  if (net.sendInput(pending, now)) {
    inputSeq += 1;
    sentAt.set(inputSeq, now);
    if (sentAt.size > 120) sentAt.delete(sentAt.keys().next().value);
    for (const press of PRESSES) pending[press] = false;
  }
}

// Frames stop when the window is hidden or covered; the pulse keeps the
// step going until they come back. While frames run it does nothing.
let lastFrameAt = performance.now();
startPulse(30, () => {
  const now = performance.now();
  if (now - lastFrameAt > 200 && now - lastStepAt > 20) {
    const dt = step(now);
    // The host's checks of who can use what look at the scene (a breach's
    // prompt, a grapple to cut, a boarder to shove): keep it up to date
    // with the state while nothing is drawn, or a joiner could not patch a
    // hole that tore open while the host looked away.
    if (sessionActive && local.isHost) syncWorld(now, dt);
  }
});

// Every browser sets up the scene from the state it has: what is where,
// and what can be used. Drawing it is the loop's job.
function syncWorld(now, dt) {
  applyState(world, state, state.players[local.id]?.atWheel ?? false, shownSteering);
  updateKit();
  updateDock(world, state, local, now);
  updateHelm(world, state, { camera, view, player, now, dt, steering: shownSteering });
  updatePower(world, state, { now, dt });
  updateEngineRoom(world, state, { now, dt });
  updateHazards(world, state, now);
  updatePirates(world, state, { now, dt, me: state.players[local.id] });
  updateHeldItems();
}

const clock = new THREE.Clock();
let bank = 0; // the ship's lean into a turn, eased
function loop() {
  const now = performance.now();
  lastFrameAt = now;
  const t = clock.getElapsedTime();

  // The ship rocks in the storm, but not while it is moored. On the way
  // up the storm builds, the bow lifts, and the deck shudders as she
  // tears free of the moorings.
  const climbed = takeoffProgress(state);
  const motion = settings.cameraShake ? settings.cameraMotion / 100 : 0;
  const rocking = (state.phase === 'result' ? 0 : climbed) * motion;
  const noseUp = state.phase === 'takeoff' ? Math.sin(climbed * Math.PI) * 0.05 * motion : 0;
  const lurch = state.phase === 'takeoff' ? Math.max(0, 1 - state.takeoff / 1.2) * Math.sin(t * 40) * 0.012 * motion : 0;
  const jolted = (now - Math.max(stormJolt, lastPirateHit(), endJolt)) / 1000; // a storm wall, a cannonball, the crash
  const jolt = jolted < 1.2 ? Math.sin(jolted * 30) * 0.05 * (1 - jolted / 1.2) * motion : 0;
  // The end of a flight: going down, she noses over and shudders and
  // rolls; coming in to the harbour, she dips her bow to the dock.
  const sinking = sinkingShare();
  const dive = (-0.15 * sinking * sinking * (3 - 2 * sinking) + Math.sin(t * 31) * 0.018 * sinking) * motion;
  const settle = state.phase === 'ending' && state.ending?.kind === 'landed' ? -Math.sin(climbed * Math.PI) * 0.04 * motion : 0;
  ship.rotation.z = Math.sin(t * 0.8) * 0.06 * rocking + noseUp + lurch + jolt + dive + settle;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03 * rocking + Math.sin(t * 1.4) * 0.07 * sinking * motion;

  const dt = step(now);

  // Bank into the turn: starboard side down when steering to starboard.
  // Eased, so a tap on the wheel doesn't jerk the camera; none with the
  // camera motion setting off.
  const leanTo = state.phase === 'flight' ? (state.steering ?? 0) * 0.05 * motion : 0;
  bank += (leanTo - bank) * Math.min(1, dt * 3);
  ship.rotation.x += bank;

  if (sessionActive && state.phase === 'gathering') {
    updateGathering(state, local, now, (id) => isTalking(id, now));
    orbitShip(t);
  } else if (sessionActive) {
    // Only one pair of hands is on the wheel: when they are ours, our own
    // guess at it (shownSteering) is what the shoulders follow.
    const crewCtx = { kitHolder: state.kit.heldBy, wheelYaw: HELM_STANCE.look, steering: shownSteering };
    crew.update(dt, crewCtx, now);
    updateOwnCharacter(dt, crewCtx);
    view.update(dt);
    updateStatus();
    updateBanner();
    updateRoundHud(now);
    updateTakeoff();
    updateEnding(now);
    updateSubtitles(state, now, settings.subtitles, subtitleLine);
    if (trainingActive()) updateTraining(now);
    updateJobs(now);
    updateCallout(now);
    updateStormAlert(now);
    updateRaidAlert();
    if (state.phase === 'flight') {
      updateShipPanel();
      updateRaidRow();
    }
  } else {
    orbitShip(t);
  }
  if (sessionActive) placeCrewVoices(now);
  updateMusicNow(now);
  updateVoiceUi(now, {
    players: state.players,
    localId: local.id,
    playing: sessionActive && !playUi.hidden,
    colorOf: (role) => ROLE_COLORS[role] ?? ROLE_COLORS.crew,
  });

  syncWorld(now, dt);
  if (sessionActive && inWorld) rollView(t, now, sinking, motion);
  const airborne = state.phase === 'takeoff' || state.phase === 'flight' || state.phase === 'ending';
  // The ship sliding to starboard: the world, and its rain, slide to port.
  // Going down she falls faster than the rain, so it streams up past her.
  const fall = RAIN_FALL - 70 * sinking;
  rain.update(dt, settings.rain && sessionActive && inWorld && airborne, -game.sideSpeed() * DRIFT_METRES, fall);
  updateSky(dt);
  markShadows(now);
  updateHarbour(world, camera, { dt, t, fair, lampsOn: state.lampsOn, sound: play });
  // The Blender dock swaps in its own lockers once it loads: paint those too.
  if (world.lockers !== paintedLockers) paintRoles();
  countFrame(now);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// --- voice -------------------------------------------------------------

// Who is talking right now: our own mic's gate, or a teammate's voice.
function isTalking(id, now) {
  return id === local.id ? voiceStatus(now).talking : isSpeaking(id, now);
}

// Each voice comes from where that teammate's character stands (as drawn,
// so it moves as smoothly as they do), heard from our own head.
let voicesPlacedAt = 0;
function placeCrewVoices(now) {
  if (now - voicesPlacedAt < 50) return;
  voicesPlacedAt = now;
  const sources = {};
  for (const other of Object.values(state.players)) {
    if (other.id === local.id || !hasVoice(other.id)) continue;
    const at = crew.meshFor(other.id)?.position ?? other;
    sources[other.id] = { x: at.x, z: at.z };
  }
  const listener = { x: player.body.position.x, z: player.body.position.z, yaw: player.lookYaw };
  placeVoices(listener, sources, {
    spatial: settings.voice3d && inWorld && state.phase !== 'gathering',
    doorOpen: state.phase === 'lobby',
  });
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
    applyShadowQuality();
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
    voice: { voiceStatus, isSpeaking, hasVoice, micState, outputRoute, voiceDelays },
    music: musicState,
  };
}

showScreen('menu');
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
