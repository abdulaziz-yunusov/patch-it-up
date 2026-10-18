// The pilot's cabin from Blender (public/models/helm_room.glb), dressed
// into the coded helm room: dashboard, gauges, map table, shelves,
// telescope, lamps. The coded walls, window, wheel and breaches stay; the
// model only adds furniture, and leaves the bow window clear for the rock.
//
// The model sits in ship space as-is (no turn, no offset): a Blender point
// (x, y, z) lands at (x, z, -y) in the game.
//
// Names from Blender mean something here:
//   col_*               blocks players (floor to top of the piece)
//   station_*           something to aim at; its `interact` custom
//                       property names the action (bell, map, telescope)
//   gauge_*_needle,     turn with the game state (`drive` property)
//   clock_hand
//   indicator_power_N   glows with the power in tube N
//   lamp_*              glowing glass; light_* empties get a point light

import * as THREE from 'three';
import { RULES, ROUTES } from './state.js';
import { play } from './sound.js';
import { toast } from './dock.js';
import { loadRoom, pivotAt } from './rooms.js';

const STATIONS = {
  bell: { label: 'Ring the cabin bell', action: 'cabinBell' },
  map: { label: 'Read the map', action: 'map' },
  telescope: { label: 'Look out (hold E)', action: 'telescope' },
};

export async function loadHelmModel(world) {
  const room = await loadRoom(world, {
    url: `${import.meta.env.BASE_URL}models/helm_room.glb`,
    name: 'helmCabin',
    stations: STATIONS,
    groups: [/^(shelf_|col_shelf)/], // shelves are many little pieces; one box for the lot
    solid: ['station_telescope'],
    // Only the lantern and two wall lamps get real lights: enough to see
    // by, without paying for six lights every frame.
    lights: ['light_lantern', 'light_wall_0', 'light_wall_3'],
  });
  if (!room) return false;
  const { model, drives } = room;

  const helm = { needles: drives, indicators: [], clock: drives.clock ?? null };
  model.traverse((obj) => {
    const lamp = /^indicator_power_(\d)$/.exec(obj.name);
    if (lamp) helm.indicators[Number(lamp[1])] = obj;
  });
  // The bell swings from its bracket.
  const bell = model.getObjectByName('station_cabin_bell');
  if (bell) helm.bellPivot = pivotAt(model, bell, new THREE.Vector3(0, 0.12, 0));

  world.helm = helm;
  return true;
}

// --- every frame ---------------------------------------------------------

const seen = { cabinBell: null };
let swingUntil = 0;
let mapWasDown = false;
let baseFov = null;
let zooming = false;

const lerp = (a, b, t) => a + (b - a) * t;

export function updateHelm(world, state, { camera, view, player, now, dt }) {
  const helm = world.helm;
  if (!helm) return;

  // Gauges read the shared state, so every crew member sees the same dial.
  const { altitude, speed, heading } = helm.needles;
  if (altitude) altitude.rotation.x = lerp(-2.2, 2.2, THREE.MathUtils.clamp(state.altitude / RULES.altitudeStart, 0, 1));
  if (speed) {
    const engines = state.power[0] / RULES.maxPerTube;
    const shake = state.phase === 'flight' ? Math.sin(now / 60) * 0.04 : 0;
    speed.rotation.x = lerp(-2.2, 2.2, engines) + shake;
  }
  if (heading) heading.rotation.y = -state.steering * 0.9 + Math.sin(now / 900) * 0.05;
  helm.indicators.forEach((lamp, i) => {
    if (!lamp) return;
    const units = state.power[i] ?? 0;
    lamp.material.emissiveIntensity = units === 0 ? 0.05 : 0.6 + units * 0.6;
  });
  if (helm.clock) {
    // In flight the clock counts down the round; at the dock it just ticks.
    const turn = state.phase === 'flight'
      ? 1 - state.timeLeft / RULES.roundSeconds
      : (now / 60000) % 1;
    helm.clock.rotation.z = -turn * Math.PI * 2;
  }

  // The cabin bell: its own counter, so the dock bell stays still.
  if (state.cabinBell !== seen.cabinBell) {
    if (seen.cabinBell !== null) {
      swingUntil = now + 1400;
      play('dock_ship_bell_ding', 0.5);
    }
    seen.cabinBell = state.cabinBell;
  }
  if (helm.bellPivot) {
    const left = Math.max(0, swingUntil - now) / 1400;
    helm.bellPivot.rotation.x = Math.sin(now / 80) * 0.45 * left;
  }

  // The map and the telescope only change what this player sees, so they
  // never go through the host.
  const aim = view.target?.userData.interact;
  const eDown = !!player.keys.KeyE && player.controls.isLocked;
  if (aim?.action === 'map' && eDown && !mapWasDown) {
    const route = ROUTES[state.route] ?? ROUTES[0];
    const where = state.phase === 'flight'
      ? `${Math.ceil(state.timeLeft)} s to the next harbour, altitude ${Math.round(state.altitude)}%`
      : 'still moored at the dock';
    toast(`Map: ${route.name} route, ${where}`, 3500);
    play('ui_button_click', 0.4);
  }
  mapWasDown = aim?.action === 'map' && eDown;

  if (baseFov === null) baseFov = camera.fov;
  // Start on the telescope, then keep holding E and turn to the window.
  zooming = eDown && (zooming || aim?.action === 'telescope');
  const target = zooming ? baseFov * 0.35 : baseFov;
  if (Math.abs(camera.fov - target) > 0.05) {
    camera.fov = lerp(camera.fov, target, Math.min(1, dt * 8));
    camera.updateProjectionMatrix();
  }
}

export function resetHelmEffects() {
  seen.cabinBell = null;
}
