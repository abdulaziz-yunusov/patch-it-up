// The engineer's power room from Blender (public/models/power_room.glb).
// The coded tubes and levers stay exactly where they were; the model adds
// glass casings and scales around them, a dynamo whose flywheel spins with
// the engines, an engine-order telegraph, the vent valve, the fuse box,
// a workbench, a battery rack, pipes and lamps.
//
// The vent valve (station_steam_valve) is the engineer's: held for three
// seconds in flight it cools every tube. The fuse box takes a spare fuse
// from the mechanic; its lamps 0..2 show the engines, shields and lift
// fuses (green fine, flashing red blown), lamp 3 the main supply.
//
// Driven parts (custom property `drive` in Blender):
//   flywheel   spins faster the more power the engines have
//   telegraph  needle points at the engine power (STOP .. FULL)
//   altitude   the big gauge on the power wall, so the engineer sees height
// lamp_warning blinks while any tube is empty, overheating or blown.

import * as THREE from 'three';
import { RULES, livePower } from './state.js';
import { play } from './sound.js';
import { loadRoom } from './rooms.js';

const STATIONS = {
  steam: { label: 'Vent the tubes (hold)', action: 'steam', role: 'engineer', hold: RULES.ventSeconds },
};
const FUSE_BOX = { label: 'Replace the fuse (hold)', action: 'fuse', hold: RULES.fuseSeconds };

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

  // Every part of the fuse box is one station.
  model.traverse((obj) => {
    if (obj.isMesh && /^(fuse_box|fuse_switch_)/.test(obj.name)) obj.userData.interact = FUSE_BOX;
  });
  const fuseLamps = [0, 1, 2, 3].map((i) => model.getObjectByName(`lamp_fuse_${i}`)).filter(Boolean);
  for (const lamp of fuseLamps) lamp.material.emissive.set('#5cd68a');

  world.power = {
    fuseLamps,
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

const seen = { steam: null, lostUnit: null };
const lostFlash = [0, 0, 0]; // when each lever stops flashing red
let steamAt = -Infinity;
const STEAM_MS = 1600;
const lerp = (a, b, t) => a + (b - a) * t;

export function updatePower(world, state, { now, dt }) {
  const room = world.power;
  if (!room) return;
  const engines = livePower(0) / RULES.maxPerTube;

  // At the dock the dynamo idles; once cast off it runs with the engines.
  if (room.flywheel) {
    const speed = state.phase !== 'lobby' ? 1 + engines * 9 : 0.8;
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

  // Fuse lamps: steady green, or flashing red for a blown fuse.
  const flash = Math.floor(now / 250) % 2 === 0;
  room.fuseLamps.forEach((lamp, i) => {
    const blown = !!state.blown?.[i];
    lamp.material.color.set(blown ? '#e2574c' : '#5cd68a');
    lamp.material.emissive.set(blown ? '#ff3b2e' : '#5cd68a');
    lamp.material.emissiveIntensity = blown ? (flash ? 3 : 0.2) : 1.2;
  });

  // Any empty, dead or overheating tube: the warning lamp blinks.
  const trouble =
    [0, 1, 2].some((i) => livePower(i) === 0) ||
    state.tubeHeat?.some((t) => t >= RULES.overheatWarn);
  const blink = trouble && Math.floor(now / 350) % 2 === 0;
  if (room.warning) room.warning.material.emissiveIntensity = blink ? 3 : 0.15;
  if (room.warningLight) room.warningLight.intensity = blink ? 1.5 : 0;

  // The furnace cooled and took a unit out of a tube: its lever flashes red
  // for a moment, so the engineer sees where the power went.
  const lost = state.lostUnit ?? { count: 0, tube: -1 };
  if (lost.count !== seen.lostUnit) {
    if (seen.lostUnit !== null && lost.tube >= 0) lostFlash[lost.tube] = now + 1200;
    seen.lostUnit = lost.count;
  }
  (world.levers ?? []).forEach((lever, i) => {
    const on = lostFlash[i] > now && Math.floor(now / 150) % 2 === 0;
    lever.material.emissive.set(on ? '#ff3b2e' : '#000000');
    lever.material.emissiveIntensity = on ? 1.5 : 0;
  });

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
  seen.lostUnit = null;
  lostFlash.fill(0);
}
