// The mechanic's engine room from Blender (public/models/engine_room.glb).
// The model brings a real engine and furnace in place of the coded grey
// box and orange cube (their colliders stay exactly as they were), plus
// a stern workbench with an anvil, a tool wall, a patch-supply rack,
// spare-part crates, a coal bin, fire buckets, a chain hoist and lamps.
// The three breach spots and the patch kit's home are left clear.
//
// Driven parts (custom property `drive` in Blender):
//   piston_0..2  pump up and down, faster with more engine power
//   flywheel     spins with the engine
//   rpm          the gauge on the engine's front
// The supply rack restocks the patch kit's planks; the bucket rail gives
// water for fires; the big crate at the stern holds the spare fuses the
// engineer's fuse box needs.
// station_furnace: the mechanic stokes it (hold E). In flight its heat is
// the ship's power budget, so the fire burns brighter or dimmer with it;
// every stoke flares for the whole crew.

import * as THREE from 'three';
import { RULES, livePower } from './state.js';
import { play } from './sound.js';
import { loadRoom } from './rooms.js';
import { ROOM_STRETCH } from './world.js';

const STATIONS = {
  stoke: { label: 'Stoke the furnace', action: 'stoke', role: 'mechanic', hold: RULES.stokeSeconds },
};

const SPARKS = 10;

export async function loadEngineModel(world) {
  const room = await loadRoom(world, {
    url: `${import.meta.env.BASE_URL}models/engine_room.glb`,
    name: 'engineRoom',
    stretch: ROOM_STRETCH.engine,
    stations: STATIONS,
    // The supply rack is many pieces; one box for the lot.
    groups: [/^(supply_|col_supply)/],
    solid: ['engine_flywheel_rim'],
    lights: ['light_cage_0', 'light_cage_1', 'light_furnace'],
    lampColor: null,
  });
  if (!room) return false;
  const { model, drives } = room;

  // Stations the model has no custom property for: every piece of the
  // rack, and of the crate, points at one interact object.
  const restock = { label: 'Restock planks (hold)', action: 'restock', role: 'mechanic', hold: RULES.restockSeconds };
  const fuses = { label: 'Take a spare fuse', action: 'takeFuse', role: 'mechanic' };
  // Anyone can take a bucket: a fire is the whole crew's emergency.
  const buckets = { label: 'Take a water bucket', action: 'takeBucket' };
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    if (/^(fire_bucket|bucket_rail)/.test(obj.name)) obj.userData.interact = buckets;
    if (/^(supply_|col_supply)/.test(obj.name)) obj.userData.interact = restock;
    if (/^(crate_big|crate_top|crate_rope|col_crate_big)/.test(obj.name)) obj.userData.interact = fuses;
  });

  // The model's engine and furnace replace the coded box and cube. Only the
  // meshes go: the colliders built from them stay in every list.
  for (const name of ['engine', 'furnace']) world.ship.getObjectByName(name)?.removeFromParent();

  for (const name of ['lamp_cage_0', 'lamp_cage_1']) {
    const bulb = model.getObjectByName(name);
    if (bulb) {
      bulb.material.emissive.set('#ffc46b');
      bulb.material.emissiveIntensity = 1.8;
    }
  }

  const pistons = [0, 1, 2].map((i) => drives[`piston_${i}`]).filter(Boolean);
  pistons.forEach((p) => (p.userData.baseY = p.position.y));

  // Sparks: little embers that jump out of the furnace door when stoked.
  const origin = model.getObjectByName('furnace_sparks_origin');
  const sparks = [];
  if (origin) {
    const geometry = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    for (let i = 0; i < SPARKS; i++) {
      const spark = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffb347' : '#ff6a1a', transparent: true }));
      spark.visible = false;
      spark.userData.v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.6, 0.6 + Math.random() * 1.2);
      origin.add(spark);
      sparks.push(spark);
    }
  }

  world.engineRoom = {
    pistons,
    flywheel: drives.flywheel ?? null,
    rpm: drives.rpm ?? null,
    glow: model.getObjectByName('lamp_furnace_glow'),
    fireLight: model.getObjectByName('light_furnace')?.children[0] ?? null,
    sparks,
    phase: 0,
  };
  return true;
}

// --- every frame ---------------------------------------------------------

const seen = { stoke: null };
let stokedAt = -Infinity;
const FLARE_MS = 1800;

export function updateEngineRoom(world, state, { now, dt }) {
  const room = world.engineRoom;
  if (!room) return;

  // Once cast off the engine runs with its power; at the dock it ticks over.
  const engines = livePower(0) / RULES.maxPerTube;
  const speed = state.phase !== 'lobby' ? 2 + engines * 10 : 1.5;
  room.phase += speed * dt;

  room.pistons.forEach((p, i) => {
    p.position.y = p.userData.baseY + Math.sin(room.phase + (i * Math.PI * 2) / 3) * 0.1;
  });
  if (room.flywheel) room.flywheel.rotation.x = room.phase;
  if (room.rpm) {
    const target = state.phase !== 'lobby' ? 2.2 - engines * 4.4 : 1.8; // low on the left
    room.rpm.rotation.z += (target + Math.sin(now / 70) * 0.03 - room.rpm.rotation.z) * Math.min(1, dt * 3);
  }

  // Stoking: a shared counter, so the whole crew sees the flare.
  if (state.stoke !== seen.stoke) {
    if (seen.stoke !== null) {
      stokedAt = now;
      play('mechanic_furnace_whoosh', 0.6);
    }
    seen.stoke = state.stoke;
  }
  const age = (now - stokedAt) / FLARE_MS;
  const flare = age >= 0 && age < 1 ? 1 - age : 0;

  // The fire always flickers a little; a stoke makes it roar. Once cast off it
  // dims as the heat burns down, so the mechanic can read it at a glance.
  const flicker = 0.8 + Math.sin(now / 53) * 0.15 + Math.sin(now / 131) * 0.1;
  const burn = state.phase !== 'lobby' ? 0.2 + state.heat * 1.4 : 1.2;
  if (room.glow) room.glow.material.emissiveIntensity = (burn + flare * 4) * flicker;
  if (room.fireLight) room.fireLight.intensity = (burn + flare * 5) * flicker;

  room.sparks.forEach((spark, i) => {
    const t = age * 1.4 - i * 0.03;
    spark.visible = t > 0 && t < 1;
    if (!spark.visible) return;
    const v = spark.userData.v;
    spark.position.set(v.x * t, v.y * t - 2.2 * t * t, v.z * t);
    spark.material.opacity = 1 - t;
  });
}

export function resetEngineEffects() {
  seen.stoke = null;
}
