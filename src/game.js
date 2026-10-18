// The game rules. Only the host runs these: everyone else sends inputs
// and draws the state that comes back.

import { KIT_HOME, RULES, roleTaken, state } from './state.js';
import { lookDirection } from './player.js';
import { BREACH_SPOTS, HELM_STANCE, SHIP } from './world.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

// The host's own clocks: when the hull next springs a leak, and when the
// next rock comes at the bow.
let nextBreachIn = 0;
let nextRockIn = 0;

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
  if (!state.breaches[id]) return false; // already mended
  state.breaches[id] = false;
  state.patched += 1;
  return true;
}

export function openCount() {
  return Object.values(state.breaches).filter(Boolean).length;
}

// Tear a new hole somewhere nothing is leaking yet.
function openBreach() {
  const sound = BREACH_SPOTS.filter((spot) => !state.breaches[spot.id]);
  if (!sound.length) return false;
  const spot = sound[Math.floor(Math.random() * sound.length)];
  state.breaches[spot.id] = true;
  state.opened += 1;
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

// A fresh round: full altitude, three minutes, a sound hull.
export function startRound() {
  state.altitude = RULES.altitudeStart;
  state.timeLeft = RULES.roundSeconds;
  state.breaches = {};
  state.opened = 0;
  state.patched = 0;
  state.power = [2, 2, 2];
  state.steering = 0;
  state.drift = 0;
  state.rock = { lane: 0, distance: 0, active: false };
  state.result = null;
  nextBreachIn = between(RULES.breachEvery);
  nextRockIn = RULES.rockEvery;
}

// Three minutes in the air: the clock, the holes, the helm, the rocks.
export function tickFlight(dt) {
  if (state.phase !== 'flight') return;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  nextBreachIn -= dt;
  if (nextBreachIn <= 0) {
    openBreach();
    nextBreachIn = between(RULES.breachEvery);
  }

  // Every open hole bleeds height away.
  const leaking = openCount();
  if (leaking > 0) {
    state.altitude = Math.max(0, state.altitude - leaking * RULES.altitudeLossPerBreach * dt);
  }

  // The helm answers slowly when the engines are starved.
  const engines = state.power[0];
  const answer = engines <= RULES.enginesLow ? 0.5 : 1;
  state.drift = clamp(state.drift + state.steering * RULES.driftRate * answer * dt, -1, 1);

  nextRockIn -= dt;
  if (!state.rock.active && nextRockIn <= 0) {
    state.rock = { lane: Math.random() * 2 - 1, distance: RULES.rockDistance, active: true };
    nextRockIn = RULES.rockEvery;
  }
  if (state.rock.active) {
    state.rock.distance -= RULES.rockSpeed * dt;
    if (state.rock.distance <= 0) {
      const dodged = Math.abs(state.rock.lane - state.drift) > RULES.rockHitWidth;
      state.rock.active = false;
      if (!dodged) takeHit();
    }
  }

  if (state.altitude <= 0) endRound('down');
  else if (state.timeLeft <= 0) endRound('landed');
}

// Shields at three or more turn half the hits aside.
function takeHit() {
  const shielded = state.power[1] >= RULES.shieldThreshold && Math.random() < 0.5;
  if (!shielded) openBreach();
}

function endRound(result) {
  state.result = result;
  state.phase = 'result';
  state.rock.active = false;
}

// From the result screen back to the dock, uniforms still on.
export function backToDock() {
  if (state.phase !== 'result') return false;
  startRound();
  state.phase = 'lobby';
  state.countdown = null;
  state.kit.heldBy = null;
  state.kit.x = KIT_HOME.x;
  state.kit.y = KIT_HOME.y;
  state.kit.z = KIT_HOME.z;
  for (const player of Object.values(state.players)) player.atWheel = false;
  return true;
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
    startRound();
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
