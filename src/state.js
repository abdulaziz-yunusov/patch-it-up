// One plain object with everything the game knows.
// The host owns it, changes it, and sends it to everyone; every browser
// draws the 3D scene from the copy it last received.

import { PLAYER } from './player.js';

export const RULES = {
  // The round, as the plan's table sets it out.
  roundSeconds: 180,
  altitudeStart: 100,
  altitudeLossPerBreach: 2, // per cent per second, per open breach
  breachEvery: [8, 15], // seconds between new breaches
  rockEvery: 10, // seconds between rocks
  rockDistance: 42, // metres ahead when one appears
  rockSpeed: 6, // metres per second
  rockHitWidth: 0.35, // how closely a rock has to line up to hit
  shieldThreshold: 3, // shields at 3+ turn half the hits aside
  enginesLow: 1, // engines at 0 or 1 halve the pilot's steering
  driftRate: 0.55, // how fast a full helm slides the ship aside

  maxPerTube: 4,
  patchSeconds: 2.5,
  steerRate: 0.9,
  reach: 2.5, // metres you can interact from
  maxPlayers: 3,
  inputHz: 30, // joiner -> host
  stateHz: 20, // host -> all
  timeoutMs: 5000, // silence this long means that browser is gone
  countdown: 5, // seconds on the deck before the ship casts off
  correction: 0.25, // how hard your own sphere is pulled to the host's answer
};

export const ROLES = ['mechanic', 'engineer', 'pilot'];

// What each power tube feeds. Lift has no rule of its own yet.
export const TUBES = ['engines', 'shields', 'lift'];

// On the dock, in front of the lockers. y = the platform (-1.2) plus the
// sphere's radius, which is where a standing player's middle sits.
export const SPAWNS = [
  { x: -3, y: -0.8, z: -9 },
  { x: 0, y: -0.8, z: -9 },
  { x: 3, y: -0.8, z: -9 },
];
export const KIT_HOME = { x: -6.6, y: 0.15, z: 1.6 };

export const state = {
  phase: 'lobby', // 'lobby' at the dock, 'flight' in the air, 'result' after
  countdown: null, // seconds left once the whole crew is aboard
  code: '', // the room code, painted on the board at the dock
  players: {}, // id -> { id, name, role, x, y, z, yaw, atWheel }
  power: [2, 2, 2], // units in the engine, shield and lift tubes
  breaches: {}, // id -> true while that hole is open
  opened: 0, // how many have torn open all round: clients flash on a change
  patched: 0, // and how many the mechanic has closed
  steering: 0, // -1 (hard to port) .. 1 (hard to starboard)
  drift: 0, // where the helm has put the ship, -1 .. 1
  rock: { lane: 0, distance: 0, active: false },
  altitude: RULES.altitudeStart,
  timeLeft: RULES.roundSeconds,
  result: null, // 'landed' or 'down', once the round ends
  kit: { heldBy: null, ...KIT_HOME },
};

// Who this browser is. Never sent anywhere.
export const local = { id: null, name: 'Deckhand', isHost: false, code: '' };

export function newPlayer(id, name, index) {
  const spawn = SPAWNS[index % SPAWNS.length];
  return {
    id,
    name,
    role: 'crew', // white until a uniform is taken from a locker
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    yaw: 0, // on the dock you arrive facing the lockers
    atWheel: false,
  };
}

export function snapshot() {
  return {
    phase: state.phase,
    countdown: state.countdown,
    code: state.code,
    players: state.players,
    power: state.power,
    breaches: state.breaches,
    opened: state.opened,
    patched: state.patched,
    steering: state.steering,
    drift: state.drift,
    rock: state.rock,
    altitude: state.altitude,
    timeLeft: state.timeLeft,
    result: state.result,
    kit: state.kit,
  };
}

export function applySnapshot(s) {
  state.phase = s.phase ?? state.phase;
  state.countdown = s.countdown ?? null;
  state.code = s.code ?? state.code;
  state.players = s.players ?? {};
  state.power = s.power ?? state.power;
  state.breaches = s.breaches ?? state.breaches;
  state.opened = s.opened ?? state.opened;
  state.patched = s.patched ?? state.patched;
  state.steering = s.steering ?? 0;
  state.drift = s.drift ?? 0;
  state.rock = s.rock ?? state.rock;
  state.altitude = s.altitude ?? state.altitude;
  state.timeLeft = s.timeLeft ?? state.timeLeft;
  state.result = s.result ?? null;
  state.kit = s.kit ?? state.kit;
}

export function roleTaken(role, exceptId) {
  return Object.values(state.players).some((p) => p.role === role && p.id !== exceptId);
}

export function playerCount() {
  return Object.keys(state.players).length;
}
