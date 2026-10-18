// The engineer's power room from Blender (public/models/power_room.glb).
// The coded tubes and levers stay exactly where they were; the model adds
// glass casings and scales around them, a dynamo whose flywheel spins with
// the engines, an engine-order telegraph, a steam valve anyone can turn,
// a workbench, a battery rack, pipes and lamps.
//
// Driven parts (custom property `drive` in Blender):
//   flywheel   spins faster the more power the engines have
//   telegraph  needle points at the engine power (STOP .. FULL)
//   altitude   the big gauge on the power wall, so the engineer sees height
// lamp_warning blinks while any tube is empty.

import * as THREE from 'three';
import { RULES } from './state.js';
import { play } from './sound.js';
import { loadRoom } from './rooms.js';

const STATIONS = {
  steam: { label: 'Turn the steam valve', action: 'steam' },
};

const PUFFS = 7;

export async function loadPowerModel(world) {
  const room = await loadRoom(world, {
    url: `${import.meta.env.BASE_URL}models/power_room.glb`,
    name: 'powerRoom',
    stations: STATIONS,
    // The dynamo is one solid lump: base, housing and flywheel together.
    groups: [/^(col_dynamo|dynamo_housing|dynamo_endcap|flywheel_)/],
    solid: ['telegraph_drum'],
    lights: ['light_cage', 'light_warning'],
    lampColor: null, // the warning lamp is red and the cells are green
  });
  if (!room) return false;
  const { model, drives } = room;

  const bulb = model.getObjectByName('lamp_cage_bulb');
  if (bulb) {
    bulb.material.emissive.set('#ffc46b');
    bulb.material.emissiveIntensity = 1.8;
  }

  // Glass casings: see-through, and drawn after the tubes inside them.
  model.traverse((obj) => {
    if (!/^tube_\d_glass$/.test(obj.name)) return;
    obj.material.transparent = true;
    obj.material.opacity = 0.22;
    obj.material.depthWrite = false;
    obj.renderOrder = 1;
  });

  // Steam puffs: a few soft balls that rise from the vent and fade.
  const origin = model.getObjectByName('steam_puff_origin');
  const puffMaterial = new THREE.MeshStandardMaterial({ color: '#f4f4f0', transparent: true, opacity: 0, depthWrite: false, flatShading: true });
  const puffs = [];
  if (origin) {
    for (let i = 0; i < PUFFS; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), puffMaterial.clone());
      puff.visible = false;
      puff.userData.drift = new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.1 - Math.random() * 0.3, 0.4 + Math.random() * 0.5);
      origin.add(puff);
      puffs.push(puff);
    }
  }

  world.power = {
    flywheel: drives.flywheel ?? null,
    telegraph: drives.telegraph ?? null,
    gauge: drives.altitude ?? null,
    warning: model.getObjectByName('lamp_warning'),
    warningLight: model.getObjectByName('light_warning')?.children[0] ?? null,
    valve: model.getObjectByName('station_steam_valve'),
    puffs,
  };
  return true;
}

// --- every frame ---------------------------------------------------------

const seen = { steam: null };
let steamAt = -Infinity;
const STEAM_MS = 1600;
const lerp = (a, b, t) => a + (b - a) * t;

export function updatePower(world, state, { now, dt }) {
  const room = world.power;
  if (!room) return;
  const engines = state.power[0] / RULES.maxPerTube;

  // At the dock the dynamo idles; in flight it runs with the engines.
  if (room.flywheel) {
    const speed = state.phase === 'flight' ? 1 + engines * 9 : 0.8;
    room.flywheel.rotation.x += speed * dt;
  }
  if (room.telegraph) {
    const target = lerp(-1.05, 1.05, engines);
    room.telegraph.rotation.x += (target - room.telegraph.rotation.x) * Math.min(1, dt * 4);
  }
  if (room.gauge) {
    const height = THREE.MathUtils.clamp(state.altitude / RULES.altitudeStart, 0, 1);
    room.gauge.rotation.z = lerp(-2.2, 2.2, height);
  }

  // Any empty tube: the warning lamp blinks.
  const empty = state.power.some((units) => units === 0);
  const blink = empty && Math.floor(now / 350) % 2 === 0;
  if (room.warning) room.warning.material.emissiveIntensity = blink ? 3 : 0.15;
  if (room.warningLight) room.warningLight.intensity = blink ? 1.5 : 0;

  // Steam: a shared counter, so everyone sees and hears the same puff.
  if (state.steam !== seen.steam) {
    if (seen.steam !== null) {
      steamAt = now;
      play('engineer_steam_hiss', 0.55);
    }
    seen.steam = state.steam;
  }
  const age = (now - steamAt) / STEAM_MS;
  if (room.valve) room.valve.rotation.z = age < 1 ? -age * Math.PI * 2 : 0;
  room.puffs.forEach((puff, i) => {
    const t = age - i * 0.06;
    puff.visible = t > 0 && t < 1;
    if (!puff.visible) return;
    puff.position.copy(puff.userData.drift).multiplyScalar(t);
    puff.scale.setScalar(0.6 + t * 2.4);
    puff.material.opacity = 0.75 * (1 - t);
  });
}

export function resetPowerEffects() {
  seen.steam = null;
}
