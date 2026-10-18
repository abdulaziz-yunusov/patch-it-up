// One plain object with everything the game knows.
// The host owns it, changes it, and sends it to everyone; every browser
// draws the 3D scene from the copy it last received.

import { PLAYER } from './player.js';

export const RULES = {
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

// On the dock, in front of the lockers. y = the platform (-1.2) plus the
// sphere's radius, which is where a standing player's middle sits.
export const SPAWNS = [
  { x: -3, y: -0.8, z: -9 },
  { x: 0, y: -0.8, z: -9 },
  { x: 3, y: -0.8, z: -9 },
];
export const KIT_HOME = { x: -6.6, y: 0.15, z: 1.6 };

export const state = {
  phase: 'lobby', // 'lobby' at the dock, 'flight' once the ship casts off
  countdown: null, // seconds left once the whole crew is aboard
  code: '', // the room code, painted on the board at the dock
  players: {}, // id -> { id, name, role, x, y, z, yaw, atWheel }
  power: [2, 2, 2],
  breaches: { b0: false, b1: false, b2: false },
  steering: 0, // -1 (hard to port) .. 1 (hard to starboard)
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
    steering: state.steering,
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
  state.steering = s.steering ?? 0;
  state.kit = s.kit ?? state.kit;
}

export function roleTaken(role, exceptId) {
  return Object.values(state.players).some((p) => p.role === role && p.id !== exceptId);
}

export function playerCount() {
  return Object.keys(state.players).length;
}
