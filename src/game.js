// The game rules. Step 5 runs these on the host only; for now they are
// the placeholder actions of step 4, working on the shared state.

import { RULES, state } from './state.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Who may touch what: the label an interactive mesh carries names a role.
export function mayUse(interact, role = state.role) {
  return !interact.role || interact.role === role;
}

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

export function toggleWheel() {
  state.atWheel = !state.atWheel;
  return state.atWheel;
}

// While you hold the wheel, A and D steer instead of walking.
export function steer(dt, keys) {
  if (keys.KeyA) state.steering = clamp(state.steering - RULES.steerRate * dt, -1, 1);
  if (keys.KeyD) state.steering = clamp(state.steering + RULES.steerRate * dt, -1, 1);
}
