// Subtitles for alarms: a line at the bottom of the screen for every
// alarm and warning, so nothing important is sound or flash alone. Each
// one is spotted as a change in the shared state, so every player gets
// the same lines. Off in the settings, nothing is shown.

import { RULES } from './state.js';
import { BREACH_SPOTS, ROOMS } from './world.js';

const SHOW_MS = 3200;
const ROOM_NAMES = Object.fromEntries(ROOMS.map((r) => [r.id, r.name.toLowerCase()]));
const SPOT_ROOM = Object.fromEntries(BREACH_SPOTS.map((s) => [s.id, s.room]));
const TUBES = ['Engines', 'Shields', 'Lift'];

let seen = null;
let queue = []; // { text, until }

function remember(state) {
  return {
    phase: state.phase,
    breaches: { ...state.breaches },
    rock: state.rock.active,
    cabinBell: state.cabinBell,
    bell: state.bell,
    lowAltitude: state.altitude <= 30,
    coldFurnace: state.heat <= 0.25,
    hot: state.tubeHeat.map((t) => t >= RULES.overheatWarn),
    blown: [...state.blown],
    planks: state.kit.planks,
    callout: state.callout.count,
  };
}

function say(text, now) {
  queue = queue.filter((line) => line.text !== text && line.until > now);
  queue.push({ text, until: now + SHOW_MS });
  if (queue.length > 3) queue.shift();
}

export function updateSubtitles(state, now, on, el) {
  const was = seen;
  seen = remember(state);
  if (was) {
    const flying = state.phase === 'flight';
    if (state.phase === 'takeoff' && was.phase === 'lobby') say('[Moorings released. Climbing!]', now);
    if (state.phase === 'flight' && was.phase === 'takeoff') say('[Hatch shut. The storm hits!]', now);
    for (const [id, open] of Object.entries(state.breaches)) {
      if (open && !was.breaches[id]) say(`[Hull breach in the ${ROOM_NAMES[SPOT_ROOM[id]] ?? 'hull'}!]`, now);
    }
    if (flying && state.rock.active && !was.rock) say('[Rock ahead! Steer clear]', now);
    if (state.cabinBell !== was.cabinBell && state.phase !== 'takeoff') say('[The cabin bell rings]', now);
    if (state.bell !== was.bell) say('[The dock bell rings]', now);
    if (flying && seen.lowAltitude && !was.lowAltitude) say('[Altitude low!]', now);
    if (flying && seen.coldFurnace && !was.coldFurnace && state.timeLeft < RULES.roundSeconds) say('[The furnace is going cold]', now);
    TUBES.forEach((name, i) => {
      if (flying && seen.hot[i] && !was.hot[i] && !seen.blown[i]) say(`[${name} overheating! Vent or lower it]`, now);
      if (seen.blown[i] && !was.blown[i]) say(`[${name} fuse blown! Spare fuses: crate in the engine room]`, now);
      if (flying && !seen.blown[i] && was.blown[i]) say(`[${name} back online]`, now);
    });
    if (flying && seen.planks === 0 && was.planks > 0) say('[Patch kit empty: restock at the supply rack]', now);
    if (seen.callout !== was.callout && state.callout.text) say(`[${state.callout.name}: ${state.callout.text}]`, now);
  }

  queue = queue.filter((line) => line.until > now);
  const text = on ? queue.map((line) => line.text).join('\n') : '';
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !text;
}

// Back at the menu: the next session starts without old news.
export function resetSubtitles() {
  seen = null;
  queue = [];
}
