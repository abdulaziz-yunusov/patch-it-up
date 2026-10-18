// The game rules. Only the host runs these: everyone else sends inputs
// and draws the state that comes back.

import { KIT_HOME, RULES, roleTaken, state } from './state.js';
import { lookDirection } from './player.js';
import { HELM_STANCE, SHIP } from './world.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Who may touch what: an interactive mesh names the role it belongs to.
export function mayUse(interact, role) {
  return !interact.role || interact.role === role;
}

// What each action name does, run by the host on behalf of one player.
export const ACTIONS = {
  patch: (interact) => patchBreach(interact.id),
  power: (interact) => movePower(interact.index),
  wheel: (interact, player, body) => toggleWheel(player, body),
  pickup: (interact, player) => pickUpKit(player),
  role: (interact, player) => pickRole(player, interact.takes),
};

export function patchBreach(id) {
  if (state.breaches[id]) return false;
  state.breaches[id] = true;
  return true;
}

// E on a lever pulls one unit over from the fullest other tube.
export function movePower(index) {
  if (state.power[index] >= RULES.maxPerTube) return false;
  let from = -1;
  state.power.forEach((units, i) => {
    if (i !== index && units > 0 && (from === -1 || units > state.power[from])) from = i;
  });
  if (from === -1) return false;
  state.power[from] -= 1;
  state.power[index] += 1;
  return true;
}

// One pair of hands on the wheel at a time.
export function toggleWheel(player, body) {
  if (player.atWheel) {
    player.atWheel = false;
    body.atWheel = false;
    return true;
  }
  if (Object.values(state.players).some((p) => p.atWheel)) return false;
  player.atWheel = true;
  body.atWheel = true;
  body.position.set(HELM_STANCE.x, body.position.y, HELM_STANCE.z);
  return true;
}

// While you hold the wheel, A and D steer instead of walking.
export function steerShip(dt, keys) {
  if (keys.KeyA) state.steering = clamp(state.steering - RULES.steerRate * dt, -1, 1);
  if (keys.KeyD) state.steering = clamp(state.steering + RULES.steerRate * dt, -1, 1);
}

export function pickUpKit(player) {
  if (state.kit.heldBy) return false;
  state.kit.heldBy = player.id;
  return true;
}

export function dropKit(player, body, yaw) {
  if (state.kit.heldBy !== player.id) return false;
  const ahead = lookDirection(yaw, 0);
  state.kit.heldBy = null;
  state.kit.x = body.position.x + ahead.x * 0.8;
  state.kit.y = KIT_HOME.y;
  state.kit.z = body.position.z + ahead.z * 0.8;
  return true;
}

// A locker hands out its uniform only if nobody else is wearing it.
export function pickRole(player, role) {
  if (!role || roleTaken(role, player.id)) return false;
  player.role = role;
  return true;
}

export function aboard(player) {
  return (
    Math.abs(player.x) < SHIP.length / 2 - 0.3 &&
    Math.abs(player.z) < SHIP.width / 2 - 0.1 &&
    player.y > -0.2
  );
}

// At the dock: once the whole crew is dressed and standing on the deck,
// count down and cast off. Anyone stepping back ashore stops the clock.
export function tickLobby(dt) {
  if (state.phase !== 'lobby') return;
  const crew = Object.values(state.players);
  const ready =
    crew.length === RULES.maxPlayers && crew.every((p) => p.role !== 'crew' && aboard(p));
  if (!ready) {
    state.countdown = null;
    return;
  }
  state.countdown = (state.countdown ?? RULES.countdown) - dt;
  if (state.countdown <= 0) {
    state.countdown = null;
    state.phase = 'flight';
  }
}

// Someone's browser closed: free what they were holding.
export function removePlayer(id, body) {
  const player = state.players[id];
  if (!player) return;
  if (state.kit.heldBy === id && body) dropKit(player, body, player.yaw);
  else if (state.kit.heldBy === id) state.kit.heldBy = null;
  delete state.players[id];
}
